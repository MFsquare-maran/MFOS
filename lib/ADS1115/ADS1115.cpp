#include "ADS1115.h"

ADS1115::ADS1115(TwoWire& wire, uint8_t addr)
    : _wire(wire),
      _addr(addr),
      _ntcVoltage(0.0f),
      _ntcResistance(0.0f),
      _temperature(0.0f),
      _waterVoltage(0.0f) {
}

bool ADS1115::begin() {
    if (!_ads.begin(_addr, &_wire)) {
        return false;
    }
    // ±4.096 V -> deckt 3.3 V ab, LSB = 0.125 mV.
    _ads.setGain(GAIN_ONE);
    return true;
}

void ADS1115::update() {
    // Einzelmessungen (Single-Ended). Jede Wandlung blockiert ~8 ms,
    // also NICHT mit 100 Hz aufrufen -> in einen langsamen Task legen.
    int16_t raw0 = _ads.readADC_SingleEnded(0);
    int16_t raw1 = _ads.readADC_SingleEnded(1);

    _ntcVoltage   = _ads.computeVolts(raw0);
    _waterVoltage = _ads.computeVolts(raw1);

    _temperature  = ntcTempFromVoltage(_ntcVoltage);
}

float ADS1115::ntcTempFromVoltage(float v) {
    // Ungültige Spannung -> kein sinnvoller Wert.
    if (v <= 0.0f || v >= NTC_VSUPPLY) {
        _ntcResistance = 0.0f;
        return NAN;
    }

    // Teiler-Annahme: VSUPPLY - Vorwiderstand - AIN0 - NTC - GND
    //   V = VSUPPLY * Rntc / (Rntc + Rseries)
    //   -> Rntc = Rseries * V / (VSUPPLY - V)
    // Ist dein NTC oben (gegen VSUPPLY) verdrahtet, statt dessen:
    //   Rntc = Rseries * (VSUPPLY - V) / V
    _ntcResistance = NTC_SERIES * v / (NTC_VSUPPLY - v);

    // Beta-Gleichung:
    //   1/T = 1/T0 + (1/Beta) * ln(Rntc / R25),  T0 = 298.15 K
    float tKelvin = 1.0f / (1.0f / 298.15f + logf(_ntcResistance / NTC_R25) / NTC_BETA);
    return tKelvin - 273.15f;
}

float ADS1115::getTemperature()   { return _temperature; }
float ADS1115::getNtcVoltage()    { return _ntcVoltage; }
float ADS1115::getNtcResistance() { return _ntcResistance; }
float ADS1115::getWaterVoltage()  { return _waterVoltage; }

bool ADS1115::isWaterDetected() {
    if (_waterVoltage > WATER_THRESHOLD_V) {
        return true;
    } else {
        return false;
    }
}