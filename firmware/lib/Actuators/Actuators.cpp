#include "Actuators.h"

Actuators::Actuators(uint8_t throttlePin, uint8_t rudderPin)
    : _throttlePin(throttlePin),
      _rudderPin(rudderPin),
      _throttle(THROTTLE_IDLE_PCT),
      _rudder(50.0f) {
}

void Actuators::begin() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    // Arduino Core 3.x: Pin direkt attachen, Kanal wird automatisch vergeben.
    ledcAttach(_throttlePin, PWM_FREQ_HZ, PWM_RES_BITS);
    ledcAttach(_rudderPin,   PWM_FREQ_HZ, PWM_RES_BITS);
#else
    // Arduino Core 2.x: Kanal einrichten und an den Pin binden.
    ledcSetup(THROTTLE_CH, PWM_FREQ_HZ, PWM_RES_BITS);
    ledcAttachPin(_throttlePin, THROTTLE_CH);
    ledcSetup(RUDDER_CH, PWM_FREQ_HZ, PWM_RES_BITS);
    ledcAttachPin(_rudderPin, RUDDER_CH);
#endif

    // Sichere Startwerte: Motor aus, Ruder mittig.
    _throttle = THROTTLE_IDLE_PCT;
    _rudder   = 50.0f;
    writeChannel(_throttlePin, _throttle);
    writeChannel(_rudderPin,   _rudder);
}

void Actuators::setThrottle(float percent) {
    _throttle = clampPercent(percent);
    writeChannel(_throttlePin, _throttle);
}

void Actuators::setRudder(float percent) {
    _rudder = clampPercent(percent);
    writeChannel(_rudderPin, _rudder);
}

void Actuators::stop() {
    _throttle = THROTTLE_IDLE_PCT;
    _rudder   = 50.0f;
    writeChannel(_throttlePin, _throttle);
    writeChannel(_rudderPin,   _rudder);
}

float Actuators::getThrottle() {
    return _throttle;
}

float Actuators::getRudder() {
    return _rudder;
}

float Actuators::clampPercent(float percent) {
    if (percent < 0.0f) {
        percent = 0.0f;
    }
    if (percent > 100.0f) {
        percent = 100.0f;
    }
    return percent;
}

void Actuators::writeChannel(uint8_t pin, float percent) {
    // Prozent -> Pulsbreite [µs]
    float    span    = (float)(SERVO_MAX_US - SERVO_MIN_US);
    uint32_t pulseUs = SERVO_MIN_US + (uint32_t)(percent / 100.0f * span);

    // Pulsbreite -> Duty für die eingestellte Auflösung
    uint32_t maxDuty = (1UL << PWM_RES_BITS) - 1;
    uint32_t duty    = (uint32_t)pulseUs * maxDuty / PWM_PERIOD_US;

#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(pin, duty);
#else
    if (pin == _throttlePin) {
        ledcWrite(THROTTLE_CH, duty);
    } else {
        ledcWrite(RUDDER_CH, duty);
    }
#endif
}