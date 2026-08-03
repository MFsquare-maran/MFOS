#pragma once

#include <Arduino.h>
#include <TinyGPSPlus.h>

// GPS-Klasse für den u-blox M8N auf UART2 (GPIO21 RX, GPIO22 TX).
//
// begin() startet die UART, update() schiebt die empfangenen Bytes in
// TinyGPSPlus und aktualisiert die zwischengespeicherten Werte. update()
// muss oft aufgerufen werden (im Task), sonst läuft der UART-Puffer über
// und es gehen NMEA-Sätze verloren.
class GpsModule {
public:
    explicit GpsModule(HardwareSerial& serial = Serial2);

    // UART starten. rx/tx sind die ESP32-Pins (rx <- GPS-TX, tx -> GPS-RX).
    void begin(uint8_t rx, uint8_t tx);

    // Empfangene Bytes parsen und Werte aktualisieren. Oft aufrufen.
    void update();

    double  getLat();          // Breitengrad
    double  getLon();          // Längengrad
    float   getSpeedMs();      // Geschwindigkeit [m/s]
    float   getSpeedKmh();     // Geschwindigkeit [km/h]
    float   getCourse();       // Kurs über Grund [°]
    uint8_t getSats();         // Anzahl Satelliten
    bool    hasFix();          // true, wenn Position gültig und frisch

private:
    TinyGPSPlus     _gps;
    HardwareSerial& _serial;

    double  _lat, _lon;
    float   _speedMs, _speedKmh;
    float   _course;
    uint8_t _sats;

    static constexpr uint32_t BAUD           = 9600;   // M8N-Default
    static constexpr uint32_t FIX_TIMEOUT_MS = 5000;   // danach gilt Fix als alt
};