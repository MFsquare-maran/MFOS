#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <SparkFunLSM9DS1.h>

// Schlanke LSM9DS1-Klasse OHNE eigenen Filter / eigene Offsets.
//
// Nutzt die eingebaute Kalibrierung der SparkFun-Lib:
//   calibrate()    -> Gyro/Accel-Bias  (Board still)
//   calibrateMag() -> Magnetometer Hard-Iron (Board drehen)
// und rechnet daraus direkt Roll/Pitch + tilt-kompensiertes Heading.
class LSM9DS1Sensor {
public:
    explicit LSM9DS1Sensor(TwoWire& wire = Wire);

    // init + Gyro/Accel-Kalibrierung (Board beim Start still halten).
    bool begin(uint8_t sda, uint8_t scl);

    // Hard-Iron-Kalibrierung: läuft 'seconds' lang, Board dabei langsam in
    // ALLE Richtungen drehen. Zeigt live die abgedeckte Spanne pro Achse,
    // lädt die Offsets in die Chip-Register und gibt die Rohwerte aus.
    void calibrateMag(uint16_t seconds = 30);

    // Feste Hard-Iron-Offsets (Rohzähler aus calibrateMag) in den Chip laden.
    // Im setup() aufrufen -> dann entfällt das Drehen bei jedem Start.
    void loadMagOffset(int16_t x, int16_t y, int16_t z);

    void update();

    float getRoll();
    float getPitch();
    float getHeading();       // tilt-kompensiert, 0..360°, deklinationskorrigiert
    float getHeadingFlat();   // simpel atan2(my,mx), nur flach gültig

    float getAccelX(); float getAccelY(); float getAccelZ();  // g
    float getGyroX();  float getGyroY();  float getGyroZ();   // °/s
    float getMagX();   float getMagY();   float getMagZ();    // gauss

private:
    LSM9DS1  _imu;
    TwoWire& _wire;

    float _ax, _ay, _az;
    float _gx, _gy, _gz;
    float _mx, _my, _mz;
    float _roll, _pitch, _heading, _headingFlat;
    float _headingFilt;                 // getiltertes Heading (Ausgabe)
    float _headingSin, _headingCos;     // Filterzustand (kreisförmig)
    bool  _hInit;

    static constexpr uint8_t AG_ADDR = 0x6B;
    static constexpr uint8_t M_ADDR  = 0x1E;

    static constexpr float DECLINATION     = 3.3f;   // Bern
    static constexpr float MOUNTING_OFFSET = -94.0f;   // nach Nordtest setzen

    // Tiefpass aufs Heading (~100 ms bei 10 ms Aufruf). 1.0 = aus, kleiner = flotter.
    static constexpr float HEADING_LP_ALPHA = 0.9f;

    // Vorzeichen (aus deinem Test: alle drei umgedreht).
    static constexpr float ROLL_SIGN    = -1.0f;
    static constexpr float PITCH_SIGN   = -1.0f;
    static constexpr float HEADING_SIGN = -1.0f;

    void readSensors();
    void computeHeading();
};