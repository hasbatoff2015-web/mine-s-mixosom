/**
 * Mobile controls follow the primary pointer.
 *
 * `(any-pointer: coarse)` and `navigator.maxTouchPoints > 0` are also true on
 * a laptop whose touchscreen is secondary to a mouse, so those stay desktop.
 * Viewport width is intentionally not part of the query: a narrow mouse window
 * must not grow a joystick.
 *
 * CSS uses the same string. Keep the two copies identical.
 */
export const TOUCH_LAYOUT_QUERY = '(pointer: coarse)';
