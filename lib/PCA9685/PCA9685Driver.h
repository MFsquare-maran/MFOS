/**********************************************************************
 *  PCA9685Driver.h  –  Wrapper um Adafruit_PWMServoDriver
 *
 *  EIN Objekt pro physischem PCA9685. Pumpe/Lichter/... bekommen
 *  dieses Objekt per Referenz und teilen es sich (siehe main-Beispiel).
 *
 *  - OE-Handling (active LOW): waehrend begin() aus, danach frei
 *  - begin(sda,scl)  -> initialisiert den I2C-Bus mit
 *  - begin()         -> Bus laeuft schon (geteilter Bus2!)
 *********************************************************************/
#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

class PCA9685Driver {
public:
  // oePin = 255 -> kein OE-Pin verwendet
  PCA9685Driver(TwoWire& wire, uint8_t addr = 0x40,
                uint8_t oePin = 255, uint16_t freqHz = 1000);

  // Variante A: Bus laeuft bereits (z.B. zentral fuer geteilten Bus2)
  bool begin();

  // Variante B: Bus wird hier mit den uebergebenen Pins initialisiert
  bool begin(int sda, int scl, uint32_t i2cClock = 400000);

  void setChannel(uint8_t ch, uint16_t value12bit);   // 0..4095
  void setPercent(uint8_t ch, float pct);             // 0.0..1.0
  void channelOff(uint8_t ch);
  void allOff();

  void enableOutputs(bool en);        // steuert OE-Pin (active LOW)
  bool isReady() const { return _ready; }

private:
  Adafruit_PWMServoDriver _pca;
  TwoWire& _wire;
  uint8_t  _oePin;
  uint16_t _freq;
  bool     _ready = false;
};