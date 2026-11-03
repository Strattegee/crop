import { createContext, useContext, type ComponentProps } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import { colours } from './styles';

/** True inside a Text, so nested Text keeps its parent's colour. */
const InText = createContext(false);

/**
 * React Native's Text with the mode's text colour by default (React Native has no inherited page colour, so
 * plain Text would stay black in dark mode). A style's own colour wins; nested Text inherits as usual.
 */
export function Text({ style, ...rest }: ComponentProps<typeof RNText>) {
  const nested = useContext(InText);
  const own = nested ? style : [{ color: colours().text }, style];
  return (
    <InText.Provider value>
      <RNText {...rest} style={own} />
    </InText.Provider>
  );
}

/** TextInput with the mode's text and placeholder colours. */
export function TextInput({ style, placeholderTextColor, ...rest }: ComponentProps<typeof RNTextInput>) {
  const c = colours();
  return <RNTextInput {...rest} style={[{ color: c.text }, style]} placeholderTextColor={placeholderTextColor ?? c.muted} />;
}
