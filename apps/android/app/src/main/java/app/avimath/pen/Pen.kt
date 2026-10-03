package app.avimath.pen

import android.view.MotionEvent

/** Every way a stylus says "my button is down". BUTTON_STYLUS_PRIMARY is what a
 *  Galaxy Tab sends; the other two cost nothing and cover pens that do not. */
private const val PEN_BUTTONS =
  MotionEvent.BUTTON_STYLUS_PRIMARY or
    MotionEvent.BUTTON_STYLUS_SECONDARY or
    MotionEvent.BUTTON_SECONDARY

/**
 * Tells the page what the pen reported, and answers whether a button is down.
 *
 * Only on CHANGE: touch events arrive well over a hundred times a second. It decides
 * nothing — `buttonState` and `toolType` reach the page as the integers Android produced,
 * and the page works out what they mean.
 */
class PenReporter(private val page: Page) {
  /** The last thing reported, so an unchanged state is not sent a hundred times a second. */
  private var lastSignal = ""

  /** A reloaded page has heard nothing, so the next event is news again. */
  fun forget() {
    lastSignal = ""
  }

  fun report(ev: MotionEvent): Boolean {
    val down = (ev.buttonState and PEN_BUTTONS) != 0
    val tool = if (ev.pointerCount > 0) ev.getToolType(0) else MotionEvent.TOOL_TYPE_UNKNOWN
    val signal = "$down/${ev.buttonState}/$tool"
    if (signal == lastSignal) {
      return down
    }

    lastSignal = signal
    page.tell("button" to down, "buttonState" to ev.buttonState, "toolType" to tool)
    return down
  }
}

/** The same event, with buttonState cleared.
 *
 *  MotionEvent has no setter for it, so the event is rebuilt through the obtain()
 *  overload that takes buttonState explicitly. Pointer properties carry the tool
 *  type and pointer coords carry pressure and tilt; losing either would turn the pen
 *  into a finger halfway through a stroke. The caller recycles the result. */
fun stripButtons(ev: MotionEvent): MotionEvent {
  val count = ev.pointerCount
  val props = Array(count) { index ->
    MotionEvent.PointerProperties().also { ev.getPointerProperties(index, it) }
  }
  val coords = Array(count) { index ->
    MotionEvent.PointerCoords().also { ev.getPointerCoords(index, it) }
  }
  return MotionEvent.obtain(
    ev.downTime,
    ev.eventTime,
    ev.action, // not actionMasked: the pointer index has to survive
    count,
    props,
    coords,
    ev.metaState,
    0, // buttonState — the one thing that changes
    ev.xPrecision,
    ev.yPrecision,
    ev.deviceId,
    ev.edgeFlags,
    ev.source,
    ev.flags
  )
}
