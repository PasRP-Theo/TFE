// Hook WebSocket capteurs désactivé à la demande.
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

export function useWebSocket({ token, onSensorUpdate, onSensorAlert }: Options) {
  void token;
  void onSensorUpdate;
  void onSensorAlert;
}