#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// ADS1115 auf I²C-Bus2 (Wire1, 0x48).
//   Channel 0 : NTC -> Temperatur [°C]
//   Channel 1 : Wasser-/Leck-Sensor -> Spannung + Schwellwert
//
// Wire1 muss vorher initialisiert sein (bei dir über pca.begin()).
class ADS1115 {
public:
    ADS1115(TwoWire& wire = Wire1, uint8_t addr = 0x48);

    bool begin();       // Chip prüfen und Gain setzen
    void update();      // beide Kanäle lesen und umrechnen

    float getTemperature();     // °C (aus dem NTC)
    float getNtcVoltage();      // V  (Rohspannung an AIN0)
    float getNtcResistance();   // Ohm (NTC-Widerstand, fürs Debuggen)

    float getWaterVoltage();    // V  (AIN1)
    bool  isWaterDetected();    // true, wenn über Schwelle (ggf. umdrehen)

private:
    Adafruit_ADS1115 _ads;
    TwoWire& _wire;
    uint8_t  _addr;

    float _ntcVoltage;
    float _ntcResistance;
    float _temperature;
    float _waterVoltage;

    // === NTC-Parameter -> AUF DEINEN NTC ANPASSEN =====================
    // Aktuell: 100 kΩ-Familie mit 47 kΩ Vorwiderstand (aus früheren Angaben).
    static constexpr float NTC_R25     = 100000.0f;  // Widerstand bei 25 °C [Ohm]
    static constexpr float NTC_BETA    = 3950.0f;    // Beta-Wert
    static constexpr float NTC_SERIES  = 47000.0f;   // Vorwiderstand [Ohm]
    static constexpr float NTC_VSUPPLY = 3.3f;       // Versorgung des Teilers [V]
    // ==================================================================

    // Wasser-/Leck-Sensor: über dieser Spannung gilt Wasser als erkannt.
    // Richtung je nach Sensor ggf. in isWaterDetected() umdrehen.
    static constexpr float WATER_THRESHOLD_V = 1.0f;

    float ntcTempFromVoltage(float v);
};