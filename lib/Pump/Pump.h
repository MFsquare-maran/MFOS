/**********************************************************************
 *  Pump.h  –  Steuerung einer Pumpe ueber einen PCA9685-Kanal
 *
 *  Bekommt das PCA9685Driver-Objekt per REFERENZ -> greift auf
 *  dasselbe Objekt zu wie alle anderen Verbraucher.
 *********************************************************************/
#pragma once

#include "PCA9685Driver.h"

class Pump {
public:
  Pump(PCA9685Driver& pca);

  void on();                 // volle Leistung
  void off();
  void setSpeed(float pct);  // 0-100 (PWM-Drehzahl)
  bool isRunning() const { return _running; }

private:
  PCA9685Driver& _pca;       // Referenz auf das GEMEINSAME Objekt
  #define PUMP_CH 4
  bool    _running = false;
};