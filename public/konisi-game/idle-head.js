/* Independent motion clock: no pointer, touch or parent-message inputs. */
(() => {
  'use strict';
  window.KONISI_IDLE_HEAD = Object.freeze({
    sample(time, enabled) {
      if (!enabled || !Number.isFinite(time)) return [0, 0];
      return [Math.sin(time * .55) * .20 + Math.sin(time * .23) * .06,
        Math.sin(time * .43) * .12];
    }
  });
})();
