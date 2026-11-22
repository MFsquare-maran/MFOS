#include "LSM9DS1Sensor.h"

LSM9DS1Sensor::LSM9DS1Sensor(TwoWire& wire)
    : _wire(wire),
      _ax(0.0f), _ay(0.0f), _az(0.0f),
      _gx(0.0f), _gy(0.0f), _gz(0.0f),
      _mx(0.0f), _my(0.0f), _mz(0.0f),
      _roll(0.0f), _pitch(0.0f), _heading(0.0f), _headingFlat(0.0f),
      _headingFilt(0.0f), _headingSin(0.0f), _headingCos(1.0f), _hInit(false) {
}

bool LSM9DS1Sensor::begin(uint8_t sda, uint8_t scl) {
    _wire.begin(sda, scl);

    _imu.settings.device.commInterface = IMU_MODE_I2C;
    _imu.settings.device.agAddress     = AG_ADDR;
    _imu.settings.device.mAddress      = M_ADDR;

    // Magnetometer rauscharm: 40 Hz, ultra-high Performance, Temp-Komp.
    _imu.settings.mag.scale                  = 4;
    _imu.settings.mag.sampleRate             = 6;
    _imu.settings.mag.tempCompensationEnable = true;
    _imu.settings.mag.XYPerformance          = 3;
    _imu.settings.mag.ZPerformance           = 3;
    _imu.settings.mag.operatingMode          = 0;

    if (_imu.begin(AG_ADDR, M_ADDR, _wire) == 0) {
        return false;
    }

    // Gyro/Accel-Bias von der Lib bestimmen (Board dabei still halten).
    // true -> readGyro()/readAccel() ziehen den Bias danach automatisch ab.
    _imu.calibrate(true);
    return true;
}

void LSM9DS1Sensor::calibrateMag(uint16_t seconds) {
    // Bestehende Offsets im Chip auf 0 -> wir kalibrieren auf echte Rohwerte.
    _imu.magOffset(0, 0);
    _imu.magOffset(1, 0);
    _imu.magOffset(2, 0);

    int16_t mnx = 32767, mny = 32767, mnz = 32767;
    int16_t mxx = -32768, mxy = -32768, mxz = -32768;

    Serial.printf("\nMag-Kalibrierung %us: Board langsam in ALLE Richtungen drehen\n", seconds);
    Serial.println("(aufrecht, auf den Kopf, ueber alle Kanten). Weg von Metall/Motor!\n");

    uint32_t t0 = millis();
    uint32_t tPrint = 0;

    while (millis() - t0 < (uint32_t)seconds * 1000UL) {
        if (_imu.magAvailable()) {
            _imu.readMag();

            if (_imu.mx < mnx) { mnx = _imu.mx; }
            if (_imu.mx > mxx) { mxx = _imu.mx; }
            if (_imu.my < mny) { mny = _imu.my; }
            if (_imu.my > mxy) { mxy = _imu.my; }
            if (_imu.mz < mnz) { mnz = _imu.mz; }
            if (_imu.mz > mxz) { mxz = _imu.mz; }
        }

        // Live-Fortschritt: abgedeckte Spanne pro Achse (gauss).
        if (millis() - tPrint > 300) {
            tPrint = millis();
            float sx = _imu.calcMag(mxx - mnx);
            float sy = _imu.calcMag(mxy - mny);
            float sz = _imu.calcMag(mxz - mnz);
            Serial.printf("Spanne  X:%.2f  Y:%.2f  Z:%.2f gauss\n", sx, sy, sz);
        }
        delay(5);
    }

    // Hard-Iron-Bias = Mittelpunkt (Rohzähler).
    int16_t biasX = (int16_t)(((int32_t)mxx + mnx) / 2);
    int16_t biasY = (int16_t)(((int32_t)mxy + mny) / 2);
    int16_t biasZ = (int16_t)(((int32_t)mxz + mnz) / 2);

    // In die Chip-Register laden.
    _imu.magOffset(0, biasX);
    _imu.magOffset(1, biasY);
    _imu.magOffset(2, biasZ);

    Serial.println("\n---- Offsets in den Chip geladen ----");
    Serial.printf("Fuer festes Laden im setup():\n");
    Serial.printf("  imu.loadMagOffset(%d, %d, %d);\n", biasX, biasY, biasZ);
    Serial.printf("Gauss: X=%.4f  Y=%.4f  Z=%.4f\n",
                  _imu.calcMag(biasX), _imu.calcMag(biasY), _imu.calcMag(biasZ));
}

void LSM9DS1Sensor::loadMagOffset(int16_t x, int16_t y, int16_t z) {
    _imu.magOffset(0, x);
    _imu.magOffset(1, y);
    _imu.magOffset(2, z);
}

void LSM9DS1Sensor::update() {
    readSensors();
    computeHeading();
}

void LSM9DS1Sensor::readSensors() {
    _imu.readAccel();   // Bias automatisch abgezogen (calibrate(true))
    _imu.readGyro();
    _imu.readMag();     // Hard-Iron via Chip-Register (nach calibrateMag)

    _ax = _imu.calcAccel(_imu.ax);
    _ay = _imu.calcAccel(_imu.ay);
    _az = _imu.calcAccel(_imu.az);

    _gx = _imu.calcGyro(_imu.gx);
    _gy = _imu.calcGyro(_imu.gy);
    _gz = _imu.calcGyro(_imu.gz);

    // Achsenlage: der Mag-Die des LSM9DS1 ist 90° gegenüber Accel/Gyro
    // gedreht -> (my, -mx, mz). Reine Hardware-Eigenheit, keine Kalibrierung.
    float mx = _imu.calcMag(_imu.mx);
    float my = _imu.calcMag(_imu.my);
    float mz = _imu.calcMag(_imu.mz);
    _mx =  my;
    _my = -mx;
    _mz =  mz;
}

void LSM9DS1Sensor::computeHeading() {
    float norm = sqrtf(_ax * _ax + _ay * _ay + _az * _az);
    if (norm < 1e-6f) {
        return;
    }
    float ax = _ax / norm;
    float ay = _ay / norm;
    float az = _az / norm;

    float roll  = atan2f(ay, az);
    float pitch = atan2f(-ax, sqrtf(ay * ay + az * az));

    // Simples Heading (ohne Tilt), nur flach gültig. Gleiche Vorzeichen-
    // konvention wie die tilt-kompensierte Variante (-my), damit beide bei
    // flachem Board denselben Wert geben.
    _headingFlat = atan2f(-_my, _mx) * RAD_TO_DEG;
    _headingFlat *= HEADING_SIGN;
    _headingFlat += DECLINATION + MOUNTING_OFFSET;
    if (_headingFlat <    0.0f) { _headingFlat += 360.0f; }
    if (_headingFlat >= 360.0f) { _headingFlat -= 360.0f; }

    // Tilt-kompensiertes Heading (eCompass).
    float cr = cosf(roll),  sr = sinf(roll);
    float cp = cosf(pitch), sp = sinf(pitch);

    float Xh = _mx * cp + _my * sr * sp + _mz * cr * sp;
    float Yh = _my * cr - _mz * sr;

    _heading = atan2f(-Yh, Xh) * RAD_TO_DEG;
    _heading *= HEADING_SIGN;
    _heading += DECLINATION + MOUNTING_OFFSET;
    if (_heading <    0.0f) { _heading += 360.0f; }
    if (_heading >= 360.0f) { _heading -= 360.0f; }

    // Kreisförmiger Tiefpass: sin/cos filtern, dann zurückrechnen. So springt
    // der Mittelwert am 0/360-Übergang nicht.
    float hr = _heading * DEG_TO_RAD;
    if (!_hInit) {
        _headingSin = sinf(hr);
        _headingCos = cosf(hr);
        _hInit = true;
    } else {
        _headingSin = HEADING_LP_ALPHA * _headingSin + (1.0f - HEADING_LP_ALPHA) * sinf(hr);
        _headingCos = HEADING_LP_ALPHA * _headingCos + (1.0f - HEADING_LP_ALPHA) * cosf(hr);
    }
    _headingFilt = atan2f(_headingSin, _headingCos) * RAD_TO_DEG;
    if (_headingFilt < 0.0f) { _headingFilt += 360.0f; }

    _roll  = roll  * RAD_TO_DEG * ROLL_SIGN;
    _pitch = pitch * RAD_TO_DEG * PITCH_SIGN;
}

// --- Getter -----------------------------------------------------------------
float LSM9DS1Sensor::getRoll()        { return _roll; }
float LSM9DS1Sensor::getPitch()       { return _pitch; }
float LSM9DS1Sensor::getHeading()     { return _headingFilt; }
float LSM9DS1Sensor::getHeadingFlat() { return _headingFlat; }

float LSM9DS1Sensor::getAccelX() { return _ax; }
float LSM9DS1Sensor::getAccelY() { return _ay; }
float LSM9DS1Sensor::getAccelZ() { return _az; }

float LSM9DS1Sensor::getGyroX() { return _gx; }
float LSM9DS1Sensor::getGyroY() { return _gy; }
float LSM9DS1Sensor::getGyroZ() { return _gz; }

float LSM9DS1Sensor::getMagX() { return _mx; }
float LSM9DS1Sensor::getMagY() { return _my; }
float LSM9DS1Sensor::getMagZ() { return _mz; }