/**********************************************************************
 *  Lights.h  –  Navigations-/Signallichter ueber PCA9685-Kanaele
 *               statische Modi + Blink-Patterns (Beacon, Strobe).
 *
 *  Teilt sich dasselbe PCA9685Driver-Objekt per Referenz.
 *  update(tic) muss regelmaessig aufgerufen werden; tic = Aufruf-
 *  Periode in ms (z.B. 10 = alle 10ms).
 *********************************************************************/
#pragma once

#include "PCA9685Driver.h"

class Lights {
public:
  Lights(PCA9685Driver& pca);
  ~Lights();

  void update(uint8_t tic);        // non-blocking, regelmaessig aufrufen (tic = ms)
  void set_mode(uint8_t mode);     // Licht-Modus waehlen (0..8)

  void allOn();                    // alle an
  void allOff();                   // alle aus

  void on_red(float pct);
  void on_green(float pct);
  void on_white1(float pct);
  void on_white2(float pct);

  void off_red(void);
  void off_green(void);
  void off_white1(void);
  void off_white2(void);

private:
  // ---- PCA9685-Kanalbelegung ----
  static constexpr uint8_t RED_CH    = 0;
  static constexpr uint8_t GREEN_CH  = 1;
  static constexpr uint8_t WHITE1_CH = 2;
  static constexpr uint8_t WHITE2_CH = 3;

  PCA9685Driver& _pca;             // Referenz auf das GEMEINSAME Objekt
  uint8_t  _tic  = 0;              // Aufruf-Periode in ms
  uint8_t  _mode = 0;              // aktueller Licht-Modus
  uint32_t _cnt  = 0;              // zaehlt pro update() hoch (fuer Patterns)

  void     lights_control(uint8_t mode);
  uint32_t ms2tic(uint16_t ms) const;                                    // ms -> Anzahl update-Ticks
  bool     window(uint16_t period_ms, uint16_t start_ms, uint16_t dur_ms) const; // im Zeitfenster?
};