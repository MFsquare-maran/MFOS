#pragma once

#include <Arduino.h>

// Steuert die beiden PWM-Ausgänge des Boots über LEDC:
//   - Throttle / ESC  (Vortrieb)
//   - Ruder-Servo     (Richtung)
//
// Eingabe ist wie beim Empfänger 0..100 % (Ruder-Mitte = 50 %), damit
// rc.getChannel() direkt durchgereicht werden kann. Der Wert wird sofort
// als Pulsbreite ins PWM geschrieben.
class Actuators {
public:
    Actuators(uint8_t throttlePin, uint8_t rudderPin);

    // LEDC einrichten und sichere Startwerte setzen (Motor aus, Ruder mittig).
    // Im setup() aufrufen.
    void begin();

    // Werte in Prozent (werden auf 0..100 geklemmt) und sofort geschrieben.
    void setThrottle(float percent);   // 0 = aus, 100 = voll
    void setRudder(float percent);     // 0 = links, 50 = mitte, 100 = rechts

    // Not-Aus: Motor auf Ruhewert, Ruder in die Mitte.
    void stop();

    // Zuletzt gesetzte Werte in Prozent.
    float getThrottle();
    float getRudder();

private:
    uint8_t _throttlePin;
    uint8_t _rudderPin;
    float   _throttle;
    float   _rudder;

    // Servo-/ESC-Signal
    static constexpr uint32_t PWM_FREQ_HZ   = 50;      // 50 Hz -> 20 ms Periode
    static constexpr uint8_t  PWM_RES_BITS  = 16;      // 16 Bit Auflösung
    static constexpr uint16_t PWM_PERIOD_US = 20000;   // 1e6 / PWM_FREQ_HZ
    static constexpr uint16_t SERVO_MIN_US  = 1000;    // entspricht 0 %
    static constexpr uint16_t SERVO_MAX_US  = 2000;    // entspricht 100 %

    // LEDC-Kanäle (nur für Arduino Core 2.x nötig).
    static constexpr uint8_t THROTTLE_CH = 0;
    static constexpr uint8_t RUDDER_CH   = 1;

    // Ruhewert Throttle:
    //   0  = Vorwärts-only-Regler (0 % = Stillstand)
    //   50 = Regler mit Rückwärts (50 % = Stillstand)  -> hier anpassen
    static constexpr float THROTTLE_IDLE_PCT = 0.0f;

    float clampPercent(float percent);
    void  writeChannel(uint8_t pin, float percent);
};