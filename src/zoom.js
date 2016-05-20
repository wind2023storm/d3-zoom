import {dispatch} from "d3-dispatch";
import {interpolateZoom} from "d3-interpolate";
import {event, customEvent, select, mouse} from "d3-selection";
import {interrupt} from "d3-transition";
import constant from "./constant";
import ZoomEvent from "./event";
import {Transform, identity} from "./transform";
import {nodrag, yesdrag} from "./nodrag";
import noevent, {nopropagation} from "./noevent";

// Ignore horizontal scrolling.
// Ignore right-click, since that should open the context menu.
function defaultFilter() {
  return event.type === "wheel" ? event.deltaY : !event.button;
}

function defaultSize() {
  var node = this.ownerSVGElement || this;
  return [node.clientWidth, node.clientHeight];
}

function defaultTransform() {
  return this.__zoom || identity;
}

export default function(started) {
  var filter = defaultFilter,
      size = defaultSize,
      scaleMin = 0,
      scaleMax = Infinity,
      center = null,
      duration = 250,
      gestures = [],
      listeners = dispatch("start", "zoom", "end").on("start", started),
      mousemoving,
      wheelTimer,
      wheelDelay = 150;

  function zoom(selection) {
    selection
        .on("wheel.zoom", wheeled)
        .on("mousedown.zoom", mousedowned)
        .on("dblclick.zoom", dblclicked)
        .on("touchstart.zoom", touchstarted)
        .on("touchmove.zoom", touchmoved)
        .on("touchend.zoom touchcancel.zoom", touchended)
        .style("-webkit-tap-highlight-color", "rgba(0,0,0,0)")
        .property("__zoom", defaultTransform);
  }

  zoom.transform = function(collection, transform) {
    var selection = collection.selection ? collection.selection() : collection;
    transform = clamp(transform);
    selection.property("__zoom", defaultTransform);
    if (collection !== selection) {
      schedule(collection, transform, center);
    } else {
      selection.interrupt().each(function() {
        var g = gesture(this, arguments).start();
        this.__zoom = typeof transform === "function" ? transform.apply(this, arguments) : transform;
        g.zoom().end();
      });
    }
  };

  zoom.scaleBy = function(selection, k) {
    zoom.scaleTo(selection, function() {
      var k0 = this.__zoom.k,
          k1 = typeof k === "function" ? k.apply(this, arguments) : k;
      return k0 * k1;
    });
  };

  zoom.scaleTo = function(selection, k) {
    zoom.transform(selection, function() {
      var t0 = this.__zoom,
          p0 = center || (p0 = size.apply(this, arguments), [p0[0] / 2, p0[1] / 2]),
          p1 = t0.invert(p0),
          k1 = typeof k === "function" ? k.apply(this, arguments) : k;
      return translate(scale(t0, k1), p0, p1);
    });
  };

  zoom.translateBy = function(selection, x, y) {
    zoom.transform(selection, function() {
      return this.__zoom.translate(
        typeof x === "function" ? x.apply(this, arguments) : x,
        typeof y === "function" ? y.apply(this, arguments) : y
      );
    });
  };

  function clamp(transform) {
    return function() {
      var t = typeof transform === "function" ? transform.apply(this, arguments) : transform;
      if (scaleMin > t.k || t.k > scaleMax) {
        var p0 = center || (p0 = size.apply(this, arguments), [p0[0] / 2, p0[1] / 2]),
            p1 = t.invert(p0);
        t = translate(scale(t, t.k), p0, p1);
      }
      return t;
    };
  }

  function scale(transform, k) {
    return new Transform(Math.max(scaleMin, Math.min(scaleMax, k)), transform.x, transform.y);
  }

  function translate(transform, p0, p1) {
    return p1 = transform.apply(p1), new Transform(transform.k, transform.x + p0[0] - p1[0], transform.y + p0[1] - p1[1]);
  }

  function schedule(transition, transform, center) {
    transition
        .on("start.zoom", function() { gesture(this, arguments).start(); })
        .on("interrupt.zoom end.zoom", function() { gesture(this, arguments).end(); })
        .tween("zoom:zoom", function() {
          var that = this,
              args = arguments,
              g = gesture(that, args),
              s = size.apply(that, args),
              p = center || [s[0] / 2, s[1] / 2],
              w = Math.max(s[0], s[1]),
              a = that.__zoom,
              b = typeof transform === "function" ? transform.apply(that, args) : transform,
              i = interpolateZoom(a.invert(p).concat(w / a.k), b.invert(p).concat(w / b.k));
          return function(t) {
            if (t === 1) that.__zoom = b; // Avoid rounding error on end.
            else { var l = i(t), k = w / l[2]; that.__zoom = new Transform(k, p[0] - l[0] * k, p[1] - l[1] * k); }
            g.zoom();
          };
        });
  }

  function gesture(that, args) {
    for (var i = 0, n = gestures.length, g; i < n; ++i) {
      if ((g = gestures[i]).that === that) {
        return g;
      }
    }
    return new Gesture(that, args);
  }

  function Gesture(that, args) {
    this.that = that;
    this.args = args;
    this.index = -1;
    this.active = 0;
    this.pointers = {};
  }

  Gesture.prototype = {
    start: function() {
      if (++this.active === 1) {
        this.index = gestures.push(this) - 1;
        this.emit("start");
      }
      return this;
    },
    zoom: function(key) {
      for (var k in this.pointers) {
        if (k !== key) {
          this.pointers[k][1] = this.that.__zoom.invert(this.pointers[k][0]);
        }
      }
      this.emit("zoom");
      return this;
    },
    end: function() {
      if (--this.active === 0) {
        gestures.splice(this.index, 1);
        this.index = -1;
        this.emit("end");
      }
      return this;
    },
    emit: function(type) {
      customEvent(new ZoomEvent(type, this.that.__zoom), listeners.apply, listeners, [type, this.that, this.args]);
    }
  };

  function wheeled() {
    if (!filter.apply(this, arguments)) return;
    var g = gesture(this, arguments),
        p0,
        p1,
        t0 = this.__zoom,
        k1 = t0.k * Math.pow(2, -event.deltaY * (event.deltaMode ? 120 : 1) / 500);

    // If there were recently wheel events, use the existing point and location.
    if (g.pointers.wheel) {
      p0 = g.pointers.wheel[0], p1 = g.pointers.wheel[1];
      clearTimeout(wheelTimer);
    }

    // Otherwise, capture the mouse point (or center) and location at the start.
    else {
      g.pointers.wheel = [p0 = center || mouse(this), p1 = t0.invert(p0)];
      interrupt(this);
      g.start();
    }

    noevent();
    wheelTimer = setTimeout(wheelidled, wheelDelay);
    this.__zoom = translate(scale(t0, k1), p0, p1);
    g.zoom("wheel");

    function wheelidled() {
      wheelTimer = null;
      delete g.pointers.wheel;
      g.end();
    }
  }

  function mousedowned() {
    if (!filter.apply(this, arguments)) return;
    var g = gesture(this, arguments),
        v = select(event.view).on("mousemove.zoom", mousemoved, true).on("mouseup.zoom", mouseupped, true).call(nodrag),
        p0 = mouse(this),
        p1 = this.__zoom.invert(p0);

    nopropagation();
    mousemoving = false;
    g.pointers.mouse = [p0, p1];
    g.start();

    function mousemoved() {
      noevent();
      mousemoving = true;
      g.that.__zoom = translate(g.that.__zoom, g.pointers.mouse[0] = mouse(g.that), g.pointers.mouse[1])
      g.zoom("mouse");
    }

    function mouseupped() {
      v.on("mousemove.zoom mouseup.zoom", null).call(yesdrag);
      if (mousemoving) v.on("click.drag", noevent, true), setTimeout(function() { v.on("click.drag", null); }, 0);
      noevent();
      delete g.pointers.mouse;
      g.end();
    }
  }

  function dblclicked() {
    if (!filter.apply(this, arguments)) return;
    var t0 = this.__zoom,
        p0 = center || mouse(this),
        p1 = t0.invert(p0),
        k1 = t0.k * (event.shiftKey ? 0.5 : 2),
        t1 = translate(scale(t0, k1), p0, p1);
    if (duration > 0) select(this).transition().duration(duration).call(schedule, t1, p0);
    else this.__zoom = t1;
  }

  function touchstarted() {
    // TODO
  }

  function touchmoved() {
    // TODO
  }

  function touchended() {
    // TODO
  }

  zoom.filter = function(_) {
    return arguments.length ? (filter = typeof _ === "function" ? _ : constant(!!_), zoom) : filter;
  };

  zoom.size = function(_) {
    return arguments.length ? (size = typeof _ === "function" ? _ : constant([+_[0], +_[1]]), zoom) : size;
  };

  zoom.scaleExtent = function(_) {
    return arguments.length ? (scaleMin = +_[0], scaleMax = +_[1], zoom) : [scaleMin, scaleMax];
  };

  zoom.center = function(_) {
    return arguments.length ? (center = _ == null ? null : [+_[0], +_[1]], zoom) : center;
  };

  zoom.duration = function(_) {
    return arguments.length ? (duration = +_, zoom) : duration;
  };

  zoom.on = function() {
    var value = listeners.on.apply(listeners, arguments);
    return value === listeners ? zoom : value;
  };

  return zoom;
}
