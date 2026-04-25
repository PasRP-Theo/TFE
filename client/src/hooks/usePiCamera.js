import { useState, useEffect } from 'react';
import { piCameraApi } from '../lib/piCameraApi.js';

export function usePiCamera(streamName = 'cam1') {
  const [isOnline, setIsOnline] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [cameraInfo, setCameraInfo] = useState(null);

  useEffect(() => {
    let mounted = true;
    
    const pollStatus = async () => {
      try {
        const cam = await piCameraApi.getCameraStatus(streamName);
        if (mounted) {
          setIsOnline(true);
          setIsStreaming(true);
          setCameraInfo(cam);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setIsOnline(false);
          setIsStreaming(false);
          setCameraInfo(null);
          setError(err.message);
        }
      }
    };

    pollStatus();
    const intervalId = setInterval(pollStatus, 5000);
    return () => { mounted = false; clearInterval(intervalId); };
  }, [streamName]);

  return { isOnline, isStreaming, error, cameraInfo };
}