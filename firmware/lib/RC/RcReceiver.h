#pragma once

#include <Arduino.h>

// SBUS-Empfänger für den Radiolink R12DSM (im SBUS-Modus, LED blau/violett).
//
// Liest das invertierte SBUS-Signal über eine Hardware-UART ein und liefert
// pro Kanal einen Wert von 0..100 %. SBUS ist invertiertes Serial mit
// 100000 Baud, 8E2, 25-Byte-Frames und 16 Kanälen à 11 Bit (0..2047).
//
// Die Invertierung übernimmt die ESP32-UART selbst (invert = true), es wird
// kein externer Inverter benötigt.
class RcReceiver {
public:
    // Im Konstruktor wird nur der RX-Pin übergeben.
    // Standardmässig wird UART1 (Serial1) verwendet: UART2 ist beim GPS,
    // UART0 am USB-Debug belegt.
    explicit RcReceiver(uint8_t rxPin, HardwareSerial& serial = Serial1);

    // UART starten (im setup() aufrufen). Aktiviert die Hardware-Invertierung.
    void begin();

    // Liest alle verfügbaren Bytes und dekodiert vollständige SBUS-Frames.
    // In jedem Loop-/Task-Durchlauf aufrufen.
    void update();

    // Kanalwert 0..100 % (geklemmt). channel ist 0-basiert (0 = Kanal 1).
    float getChannel(uint8_t channel);

    // Roher SBUS-Wert 0..2047 (für Debug und Kalibrierung).
    uint16_t getRaw(uint8_t channel);

    // true, wenn kürzlich ein gültiger Frame kam und kein Failsafe aktiv ist.
    bool hasSignal();

    // Failsafe-Flag aus dem letzten Frame (Sender aus / ausser Reichweite).
    bool isFailsafe();

    // Frame-Lost-Flag aus dem letzten Frame (einzelner Frame verloren).
    bool isFrameLost();

private:
    HardwareSerial& _serial;
    uint8_t         _rxPin;

    // SBUS-Konstanten
    static constexpr uint8_t  NUM_CHANNELS    = 16;
    static constexpr uint32_t SBUS_BAUD       = 100000;
    static constexpr uint8_t  SBUS_FRAME_SIZE = 25;
    static constexpr uint8_t  SBUS_HEADER     = 0x0F;
    static constexpr uint8_t  SBUS_FOOTER     = 0x00;

    // Wertebereich für die 0..100 %-Umrechnung.
    // 172 = untere Grenze (0 %), 1811 = obere Grenze (100 %).
    static constexpr uint16_t SBUS_MIN = 172;
    static constexpr uint16_t SBUS_MAX = 1811;

    // Nach dieser Zeit ohne gültigen Frame gilt das Signal als verloren.
    static constexpr uint32_t SIGNAL_TIMEOUT_MS = 100;

    // Empfangspuffer und Parser-Status
    uint8_t  _frame[SBUS_FRAME_SIZE];
    uint8_t  _index;
    uint16_t _channels[NUM_CHANNELS];
    bool     _failsafe;
    bool     _frameLost;
    uint32_t _lastFrameMs;

    // Zerlegt einen vollständigen, gültigen Frame in die 16 Kanäle.
    void decodeFrame();

    // Rechnet einen rohen SBUS-Wert in 0..100 % um.
    float rawToPercent(uint16_t raw);
};