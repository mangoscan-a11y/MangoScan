/*
 * Turns ultrasonic distance readings into a debounced "bin full" state.
 * Pure logic, no Arduino calls, so it can be tested on its own.
 *
 *   BinLevel level(8, 3, 3);   // full at 8 cm or closer, clears above 11 cm, 3 readings to switch
 *   if (level.update(cm)) { ...level.full just changed... }
 *
 * `cm` is the distance from the sensor to the top of the fruit, or -1 when no echo came back.
 */
#pragma once
#include <stdint.h>

struct BinLevel {
  int fullCm;         // full when the distance is at or below this
  int clearMarginCm;  // once full, the distance must exceed fullCm + this to clear
  uint8_t confirm;    // consecutive agreeing readings needed to change state

  bool full = false;
  bool known = false;  // true once the state is settled: one far reading, or `confirm` close ones in a row

  BinLevel(int fullCm_, int clearMarginCm_, uint8_t confirm_)
      : fullCm(fullCm_), clearMarginCm(clearMarginCm_), confirm(confirm_) {}

  // Feed one reading. Returns true when `full` changed (a sensor's first verdict can be "full" too).
  bool update(int cm) {
    // No echo says nothing about the fruit: keep the last state and break any streak.
    if (cm < 0) {
      streak_ = 0;
      return false;
    }
    if (!known) {
      // A far reading means not full and needs no waiting. A close one needs `confirm` in a row,
      // so a single stray echo (a loose wire, noise) cannot raise a false "bin full".
      if (cm > fullCm) {
        known = true;
        full = false;
        streak_ = 0;
        return false;
      }
      if (++streak_ < confirm) return false;
      known = true;
      full = true;
      streak_ = 0;
      return true;
    }
    bool wanted = full ? cm <= fullCm + clearMarginCm : cm <= fullCm;
    if (wanted == full) {
      streak_ = 0;
      return false;
    }
    if (++streak_ < confirm) return false;
    full = wanted;
    streak_ = 0;
    return true;
  }

 private:
  uint8_t streak_ = 0;
};
