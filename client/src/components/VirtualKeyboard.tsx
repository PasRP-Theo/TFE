import React, { useState, createContext, useContext, useRef, useCallback, useEffect, Suspense } from 'react';
import type { KeyboardReactInterface } from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import './VirtualKeyboard.css';

// Chargement asynchrone (Lazy Load) pour optimiser les performances et isoler les erreurs
const Keyboard = React.lazy(() => import('react-simple-keyboard'));

interface KeyboardContextType {
  showKeyboard: (
    initialValue: string,
    onChange: (value: string) => void,
    onClose?: () => void
  ) => void;
  hideKeyboard: () => void;
  isKeyboardVisible: boolean;
}

const KeyboardContext = createContext<KeyboardContextType | null>(null);

export const useVirtualKeyboard = () => {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useVirtualKeyboard must be used within a KeyboardProvider');
  }

  const isEnabled = window.localStorage.getItem('sentys:virtual_keyboard') === 'true';

  return {
    showKeyboard: isEnabled ? context.showKeyboard : () => {},
    hideKeyboard: isEnabled ? context.hideKeyboard : () => {},
    isKeyboardVisible: isEnabled && context.isKeyboardVisible,
    isKeyboardEnabled: isEnabled,
  };
};

export const VirtualKeyboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [layoutName, setLayoutName] = useState('default');
  const onChangeCallbackRef = useRef<(value: string) => void>(() => {});
  const onCloseCallbackRef = useRef<() => void>(() => {});
  const keyboardRef = useRef<KeyboardReactInterface | null>(null);
  const [initialValue, setInitialValue] = useState('');

  const showKeyboard = useCallback((
    currentValue: string,
    onChange: (value: string) => void,
    onClose?: () => void
  ) => {
    setInitialValue(currentValue);
    onChangeCallbackRef.current = onChange;
    onCloseCallbackRef.current = onClose || (() => {});
    setIsVisible(true);
  }, []);

  useEffect(() => {
    if (isVisible && keyboardRef.current) {
      keyboardRef.current.setInput(initialValue);
    }
  }, [isVisible, initialValue]);

  const hideKeyboard = useCallback(() => {
    onCloseCallbackRef.current();
    setIsVisible(false);
  }, []);

  const handleKeyboardChange = (input: string) => {
    onChangeCallbackRef.current(input);
  };

  const handleShift = () => {
    setLayoutName(layoutName === 'default' ? 'shift' : 'default');
  };

  const onKeyPress = (button: string) => {
    if (button === '{shift}' || button === '{lock}') handleShift();
    if (button === '{enter}') hideKeyboard();
  };

  const value = { showKeyboard, hideKeyboard, isKeyboardVisible: isVisible };

  return (
    <KeyboardContext.Provider value={value}>
      {children}
      {isVisible && (
        <div className="keyboard-container">
          <Suspense fallback={<div style={{ padding: '20px', color: 'var(--text-primary)', textAlign: 'center' }}>Chargement du clavier...</div>}>
            <Keyboard
              keyboardRef={r => (keyboardRef.current = r)}
              layoutName={layoutName}
              onChange={handleKeyboardChange}
              onKeyPress={onKeyPress}
            />
          </Suspense>
        </div>
      )}
    </KeyboardContext.Provider>
  );
};