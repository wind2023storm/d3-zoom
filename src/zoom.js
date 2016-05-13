import {dispatch} from "d3-dispatch";
import {event, select} from "d3-selection";

export default function(started) {

  var listeners = dispatch("start", "zoom", "end")
      .on("start", started);

  function zoom(selection) {
    selection
        .on("wheel.zoom", wheeled)
        .on("mousedown.zoom", mousedowned)
        .on("touchstart.zoom", touchstarted)
        .on("touchmove.zoom", touchmoved)
        .on("touchend.zoom touchcancel.zoom", touchended)
        .style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
  }

  function wheeled() {
    listeners.apply("zoom", this, arguments);
    event.preventDefault();
    // TODO emit start on first wheel event
    // TODO emit end if no wheel events seen in 50ms
    // TODO compute scale delta based on event.deltaY and event.deltaMode
    // TODO allow zoom center to be specified, and default to mouse position
  }

  function mousedowned() {
    select(event.view).on("mousemove.zoom", mousemoved).on("mouseup.zoom", mouseupped);
    // TODO
  }

  function mousemoved() {
    // TODO
  }

  function mouseupped() {
    select(event.view).on("mousemove.zoom mouseup.zoom", null);
    // TODO
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

  zoom.on = function() {
    var value = listeners.on.apply(listeners, arguments);
    return value === listeners ? zoom : value;
  };

  return zoom;
}
