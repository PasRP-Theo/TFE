import { createContext, useContext } from 'react';

export interface KeyboardContextType {
  showKeyboard: (
    initialValue: string,
    onChange: (value: string) => void,
    onClose?: () => void
  ) => void;
  hideKeyboard: () => void;
  isKeyboardVisible: boolean;
}

export const KeyboardContext = createContext<KeyboardContextType | null>(null);

export const useVirtualKeyboard = () => {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useVirtualKeyboard must be used within a KeyboardProvider');
  }

  const isEnabled = typeof window !== 'undefined' && window.localStorage.getItem('sentys:virtual_keyboard') === 'true';

  return {
    showKeyboard: isEnabled ? context.showKeyboard : () => {},
    hideKeyboard: isEnabled ? context.hideKeyboard : () => {},
    isKeyboardVisible: isEnabled && context.isKeyboardVisible,
    isKeyboardEnabled: isEnabled,
  };
};