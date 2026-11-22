#include "Pump.h"

Pump::Pump(PCA9685Driver& pca)
  : _pca(pca) {}

void Pump::on() {
  _pca.setPercent(PUMP_CH, 1.0f);
  _running = true;
}

void Pump::off() {
  _pca.channelOff(PUMP_CH);
  _running = false;
}

void Pump::setSpeed(float pct) {
  _pca.setPercent(PUMP_CH, pct / 100.0f);
  _running = (pct > 0.0f);
}