#include "Lights.h"

Lights::Lights(PCA9685Driver& pca)
  : _pca(pca) {
}

Lights::~Lights() {
  allOff();
}

// ---- update: cnt hochzaehlen, Aufruf-Periode merken, Pattern rechnen ----
void Lights::update(uint8_t tic) {
  _tic = tic;             // Aufruf-Periode in ms (z.B. 10 = alle 10ms)
  _cnt++;                 // ein Schritt pro Aufruf
  lights_control(_mode);
}

void Lights::set_mode(uint8_t mode) {
  _mode = mode;
  _cnt  = 0;              // Pattern beim Moduswechsel sauber starten
}

// ===================================================================
//  Zeit-Helfer  (Pattern in ms definieren, unabhaengig von _tic)
// ===================================================================

// Millisekunden -> Anzahl update-Ticks  (ein Tick = _tic ms)
uint32_t Lights::ms2tic(uint16_t ms) const {
  if (_tic == 0) return 0;
  return ms / _tic;
}

// Liegt die aktuelle Position im Zyklus im Fenster [start, start+dur) ?
bool Lights::window(uint16_t period_ms, uint16_t start_ms, uint16_t dur_ms) const {
  if (_tic == 0) return false;
  uint32_t period = ms2tic(period_ms);
  if (period == 0) period = 1;
  uint32_t start = ms2tic(start_ms);
  uint32_t end   = start + ms2tic(dur_ms);
  uint32_t pos   = _cnt % period;
  return (pos >= start) && (pos < end);
}

// ===================================================================
//  Einzel-Kanaele
// ===================================================================
void Lights::on_red(float pct)    { _pca.setPercent(RED_CH,    pct / 100.0f); }
void Lights::on_green(float pct)  { _pca.setPercent(GREEN_CH,  pct / 100.0f); }
void Lights::on_white1(float pct) { _pca.setPercent(WHITE1_CH, pct / 100.0f); }
void Lights::on_white2(float pct) { _pca.setPercent(WHITE2_CH, pct / 100.0f); }

void Lights::off_red(void)    { _pca.channelOff(RED_CH);    }
void Lights::off_green(void)  { _pca.channelOff(GREEN_CH);  }
void Lights::off_white1(void) { _pca.channelOff(WHITE1_CH); }
void Lights::off_white2(void) { _pca.channelOff(WHITE2_CH); }

void Lights::allOn() {
  on_red(100); on_green(100); on_white1(100); on_white2(100);
}

void Lights::allOff() {
  off_red(); off_green(); off_white1(); off_white2();
}

// ===================================================================
//  Steuerung  (0..2 statisch,  3..5 Patterns)
// ===================================================================
void Lights::lights_control(uint8_t mode) {
  switch (mode) {

    case 0:   // alle aus
      off_red(); off_green(); off_white1(); off_white2();
    break;

    case 1:   // alle an
      on_red(100); on_green(100); on_white1(100); on_white2(100);
    break;

    case 2:   // Position Backbord (links) + Steuerbord (rechts)
      on_red(100);
      on_green(100);
      off_white1(); off_white2();
    break;

    case 3: {   // Position steady + weisser Doppelblitz
      on_red(100);
      on_green(100);

      bool s_3 = window(2000, 0, 50) || window(2000, 120, 50);
      if (s_3) {
        on_white1(100);
        on_white2(100);
      } else {
        off_white1();
        off_white2();
      }
      break;
    }

    case 4: {   // nur weisser Doppelblitz
      off_red();
      off_green();

      bool s_4 = window(1000, 0, 50) || window(1000, 120, 50);
      if (s_4) {
        on_white1(100);
        on_white2(100);
      } else {
        off_white1();
        off_white2();
      }
      break;
    }

    case 5: {   // alle zusammen langsam blinken (500ms an / 500ms aus)
      bool s_5 = window(1000, 0, 500);
      if (s_5) {
        on_white1(100);
        on_white2(100);
        on_red(100);
        on_green(100);
      } else {
        off_white1();
        off_white2();
        off_red();
        off_green();
      }
      break;
    }

    default:
      allOff();
  }
}