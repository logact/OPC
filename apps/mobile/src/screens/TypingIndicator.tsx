import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { theme } from '../theme';

const DOT_COUNT = 3;
const CYCLE_MS = 1200; // prototype `blink 1.2s infinite`
const STAGGER_MS = 200; // nth-child delays of .2s / .4s
const DIM_OPACITY = 0.25;

/**
 * Typing-indicator bubble (three dots with a staggered blink), mirroring the
 * prototype's `.bubble.typing` keyframes: opacity .25↔1 on a 1.2s cycle with
 * 0.2s offsets between dots. Rendered by ChatScreen inside agent typing rows
 * (wired up in J11).
 */
export function TypingIndicator(): React.JSX.Element {
  const dots = useRef(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(DIM_OPACITY)),
  ).current;

  useEffect(() => {
    // One 1.2s cycle per dot: ramp up over 480ms (peak at 40%), back down over
    // 480ms, hold dim for the remaining 240ms — matching the CSS keyframes.
    const loops = dots.map((value, index) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: 480,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: DIM_OPACITY,
            duration: 480,
            useNativeDriver: true,
          }),
          Animated.delay(CYCLE_MS - 960),
        ]),
      );
      // Stagger the start so the loop itself stays exactly 1.2s per dot.
      const startTimer = setTimeout(() => loop.start(), index * STAGGER_MS);
      return { loop, startTimer };
    });
    return () => {
      for (const { loop, startTimer } of loops) {
        clearTimeout(startTimer);
        loop.stop();
      }
    };
  }, [dots]);

  return (
    <Animated.View style={styles.bubble} testID="typing-indicator">
      {dots.map((opacity, index) => (
        <Animated.View key={index} style={[styles.dot, { opacity }]} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.bubbleOther,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomLeftRadius: 14,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.muted,
  },
});
