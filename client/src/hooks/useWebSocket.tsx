import { useEffect, useRef, useCallback } from 'react';

export interface SensorUpdate {
  sensorId:   number;
  sensorName: string;
  topic:      string;
  value:      number;
  unit:       string;
  status:     'OK' | 'ALERTE';
}

export interface SensorAlert {
  sensorId:   number;
  sensorName: string;
  value:      number;
  unit:       string;
  alertAt:    number;
}

interface Options {
  token:          string | null;
  onSensorUpdate: (data: SensorUpdate) => void;
  onSensorAlert:  (data: SensorAlert)  => void;
}

const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:4000';

export function useWebSocket({ token, onSensorUpdate, onSensorAlert }: Options) {
  const ws        = useRef<WebSocket | null>(null);
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!token) return;
    if (ws.current?.readyState === WebSocket.OPEN) return;

    const socket = new WebSocket(`${WS_BASE}/ws?token=${token}`);
    ws.current   = socket;

    socket.onopen = () => {
      console.log('🔌 WebSocket connecté');
      if (reconnect.current) clearTimeout(reconnect.current);
    };

    socket.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'sensor_update') onSensorUpdate(msg.payload);
        if (msg.type === 'sensor_alert')  onSensorAlert(msg.payload);
      } catch { /* ignoré */ }
    };

    socket.onclose = () => {
      console.log('🔌 WS déconnecté, retry dans 5s...');
      reconnect.current = setTimeout(connect, 5000);
    };

    socket.onerror = () => socket.close();
  }, [token, onSensorUpdate, onSensorAlert]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnect.current) clearTimeout(reconnect.current);
      ws.current?.close();
    };
  }, [connect]);
}