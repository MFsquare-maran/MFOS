#include "GpsModule.h"

GpsModule::GpsModule(HardwareSerial& serial)
    : _serial(serial),
      _lat(0.0), _lon(0.0),
      _speedMs(0.0f), _speedKmh(0.0f),
      _course(0.0f),
      _sats(0) {
}

void GpsModule::begin(uint8_t rx, uint8_t tx) {
    _serial.begin(BAUD, SERIAL_8N1, rx, tx);
}

void GpsModule::update() {
    // Alle wartenden Bytes in den Parser schieben.
    while (_serial.available() > 0) {
        _gps.encode(_serial.read());
    }

    // Zwischenspeichern, sobald ein Wert gültig ist.
    if (_gps.location.isValid()) {
        _lat = _gps.location.lat();
        _lon = _gps.location.lng();
    }
    if (_gps.speed.isValid()) {
        _speedMs  = _gps.speed.mps();
        _speedKmh = _gps.speed.kmph();
    }
    if (_gps.course.isValid()) {
        _course = _gps.course.deg();
    }
    _sats = _gps.satellites.value();
}

double  GpsModule::getLat()      { return _lat; }
double  GpsModule::getLon()      { return _lon; }
float   GpsModule::getSpeedMs()  { return _speedMs; }
float   GpsModule::getSpeedKmh() { return _speedKmh; }
float   GpsModule::getCourse()   { return _course; }
uint8_t GpsModule::getSats()     { return _sats; }

bool GpsModule::hasFix() {
    // Position muss gültig UND frisch sein (nicht älter als FIX_TIMEOUT_MS).
    if (_gps.location.isValid() && _gps.location.age() < FIX_TIMEOUT_MS) {
        return true;
    } else {
        return false;
    }
}