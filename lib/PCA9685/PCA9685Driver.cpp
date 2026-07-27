#include "PCA9685Driver.h"

PCA9685Driver::PCA9685Driver(TwoWire& wire, uint8_t addr,
                             uint8_t oePin, uint16_t freqHz)
  : _pca(addr, wire), _wire(wire), _oePin(oePin), _freq(freqHz) {}

bool PCA9685Driver::begin() {
  // OE sofort HIGH -> Ausgaenge aus, solange nicht konfiguriert
  if (_oePin != 255) {
    pinMode(_oePin, OUTPUT);
    digitalWrite(_oePin, HIGH);          // HIGH = disabled
  }

  if (!_pca.begin()) {                    // meldet false wenn Chip nicht antwortet
    _ready = false;
    return false;
  }
  _pca.setPWMFreq(_freq);
  allOff();                               // definierter Startzustand

  enableOutputs(true);                    // OE LOW -> Ausgaenge frei
  _ready = true;
  return true;
}

bool PCA9685Driver::begin(int sda, int scl, uint32_t i2cClock) {
  _wire.begin(sda, scl);
  _wire.setClock(i2cClock);
  return begin();
}

void PCA9685Driver::setChannel(uint8_t ch, uint16_t value) {
  if (!_ready || ch > 15) return;
  if (value > 4095) value = 4095;
  _pca.setPin(ch, value);                 // handhabt full-on/off korrekt
}

void PCA9685Driver::setPercent(uint8_t ch, float pct) {
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 1.0f) pct = 1.0f;
  setChannel(ch, (uint16_t)(pct * 4095.0f + 0.5f));
}

void PCA9685Driver::channelOff(uint8_t ch) {
  if (ch > 15) return;
  _pca.setPin(ch, 0);
}

void PCA9685Driver::allOff() {
  for (uint8_t c = 0; c < 16; c++) _pca.setPin(c, 0);
}

void PCA9685Driver::enableOutputs(bool en) {
  if (_oePin == 255) return;
  digitalWrite(_oePin, en ? LOW : HIGH);  // active LOW
}