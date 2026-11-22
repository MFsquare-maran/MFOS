#include "RcReceiver.h"

RcReceiver::RcReceiver(uint8_t rxPin, HardwareSerial& serial)
    : _serial(serial),
      _rxPin(rxPin),
      _index(0),
      _failsafe(true),
      _frameLost(true),
      _lastFrameMs(0) {
    // Sicherer Startwert: alle Kanäle auf 0 %.
    for (uint8_t i = 0; i < NUM_CHANNELS; i++) {
        _channels[i] = SBUS_MIN;
    }
}

void RcReceiver::begin() {
    // SBUS: 100000 Baud, 8 Datenbits, gerade Parität, 2 Stoppbits, invertiert.
    // txPin = -1, da nichts zum Empfänger gesendet wird.
    _serial.begin(SBUS_BAUD, SERIAL_8E2, _rxPin, -1, true);
}

void RcReceiver::update() {
    while (_serial.available() > 0) {
        uint8_t b = _serial.read();

        if (_index == 0) {
            // Noch nicht synchron: auf das Startbyte warten.
            if (b == SBUS_HEADER) {
                _frame[0] = b;
                _index = 1;
            }
        } else {
            _frame[_index] = b;
            _index++;

            if (_index >= SBUS_FRAME_SIZE) {
                _index = 0;
                // Frame nur übernehmen, wenn das Fussbyte stimmt.
                // Sonst war das 0x0F nur zufällig in den Nutzdaten und
                // wir synchronisieren beim nächsten Startbyte neu.
                if (_frame[SBUS_FRAME_SIZE - 1] == SBUS_FOOTER) {
                    decodeFrame();
                    _lastFrameMs = millis();
                }
            }
        }
    }
}

void RcReceiver::decodeFrame() {
    // 16 Kanäle à 11 Bit aus den Bytes 1..22 entpacken.
    _channels[0]  = (((_frame[1])        | (_frame[2]  << 8))                     & 0x07FF);
    _channels[1]  = (((_frame[2]  >> 3)  | (_frame[3]  << 5))                     & 0x07FF);
    _channels[2]  = (((_frame[3]  >> 6)  | (_frame[4]  << 2) | (_frame[5]  << 10)) & 0x07FF);
    _channels[3]  = (((_frame[5]  >> 1)  | (_frame[6]  << 7))                     & 0x07FF);
    _channels[4]  = (((_frame[6]  >> 4)  | (_frame[7]  << 4))                     & 0x07FF);
    _channels[5]  = (((_frame[7]  >> 7)  | (_frame[8]  << 1) | (_frame[9]  << 9))  & 0x07FF);
    _channels[6]  = (((_frame[9]  >> 2)  | (_frame[10] << 6))                     & 0x07FF);
    _channels[7]  = (((_frame[10] >> 5)  | (_frame[11] << 3))                     & 0x07FF);
    _channels[8]  = (((_frame[12])       | (_frame[13] << 8))                     & 0x07FF);
    _channels[9]  = (((_frame[13] >> 3)  | (_frame[14] << 5))                     & 0x07FF);
    _channels[10] = (((_frame[14] >> 6)  | (_frame[15] << 2) | (_frame[16] << 10)) & 0x07FF);
    _channels[11] = (((_frame[16] >> 1)  | (_frame[17] << 7))                     & 0x07FF);
    _channels[12] = (((_frame[17] >> 4)  | (_frame[18] << 4))                     & 0x07FF);
    _channels[13] = (((_frame[18] >> 7)  | (_frame[19] << 1) | (_frame[20] << 9))  & 0x07FF);
    _channels[14] = (((_frame[20] >> 2)  | (_frame[21] << 6))                     & 0x07FF);
    _channels[15] = (((_frame[21] >> 5)  | (_frame[22] << 3))                     & 0x07FF);

    // Flags aus Byte 23:
    //   Bit 2 (0x04) = Frame Lost
    //   Bit 3 (0x08) = Failsafe aktiv
    _frameLost = (_frame[23] & 0x04) != 0;
    _failsafe  = (_frame[23] & 0x08) != 0;
}

float RcReceiver::getChannel(uint8_t channel) {
    if (channel >= NUM_CHANNELS) {
        return 0.0f;
    }
    return rawToPercent(_channels[channel]);
}

uint16_t RcReceiver::getRaw(uint8_t channel) {
    if (channel >= NUM_CHANNELS) {
        return 0;
    }
    return _channels[channel];
}

bool RcReceiver::hasSignal() {
    bool recent = (millis() - _lastFrameMs) < SIGNAL_TIMEOUT_MS;
    if (recent && !_failsafe) {
        return true;
    } else {
        return false;
    }
}

bool RcReceiver::isFailsafe() {
    return _failsafe;
}

bool RcReceiver::isFrameLost() {
    return _frameLost;
}

float RcReceiver::rawToPercent(uint16_t raw) {
    // Auf den gültigen Bereich klemmen.
    if (raw < SBUS_MIN) {
        raw = SBUS_MIN;
    }
    if (raw > SBUS_MAX) {
        raw = SBUS_MAX;
    }

    float span  = (float)(SBUS_MAX - SBUS_MIN);
    float value = (float)(raw - SBUS_MIN) / span * 100.0f;
    return value;
}