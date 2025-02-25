import { useEffect, useLayoutEffect, useMemo, useState } from 'react';

const tailwindColors = [
    'red-500',
    'yellow-500',
    'green-500',
    'blue-500',
    'indigo-500',
    'purple-500',
    'pink-500',
    'gray-500',
    'red-400',
    'yellow-400',
    'green-400',
    'blue-400',
    'indigo-400',
    'purple-400',
    'pink-400',
    'gray-400',
    'red-300',
];

const hashCode = (str: string) => {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

export const useRandomColor = (text: string) => {
    const color = useMemo(() => {
        // hash the text
        // use the hash to pick a color
        const hash = hashCode(text);
        return tailwindColors[Math.abs(hash) % tailwindColors.length];
    }, [text]);

    return color;
};

const breakpoints = {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    '2xl': 1536,
};

const breakpointNames = Object.keys(breakpoints);

function getBreakpoint(width: number) {
    let breakpoint = 'sm';
    for (let i = 0; i < breakpointNames.length; i++) {
        // Typescript isn't smart enough to know that breakpointNames[i]
        // is a key of breakpoints with the specific allowed keys
        const name = breakpointNames[i] as keyof typeof breakpoints;
        if (width >= breakpoints[name]) {
            breakpoint = breakpointNames[i];
            continue;
        } else {
            break;
        }
    }
    return breakpoint;
}

export const useTailwindBreakpoint = () => {
    const [breakpoint, setBreakpoint] = useState(
        getBreakpoint(window.innerWidth),
    );

    useLayoutEffect(() => {
        const onResize = () => {
            const newBreakpoint = getBreakpoint(window.innerWidth);
            if (breakpoint !== newBreakpoint) setBreakpoint(newBreakpoint);
        };

        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [breakpoint]);

    return breakpoint;
};

export const useIsAtLeastTailwindBreakpoint = (breakpoint: string) => {
    const currentBreakpoint = useTailwindBreakpoint();

    return (
        breakpointNames.indexOf(currentBreakpoint) >=
        breakpointNames.indexOf(breakpoint)
    );
};

export const useIsMobile = (breakpoint = 'lg') => {
    return useIsAtLeastTailwindBreakpoint(breakpoint) === false;
};

export const useThemeColor = (color: string) => {
    const originalColor = useMemo(
        () =>
            document
                .querySelector('meta[name="theme-color"]')
                ?.getAttribute('content'),
        [],
    );

    useEffect(() => {
        if (originalColor !== color) {
            document
                .querySelector('meta[name="theme-color"]')
                ?.setAttribute('content', color);
        }

        return () => {
            if (originalColor) {
                document
                    .querySelector('meta[name="theme-color"]')
                    ?.setAttribute('content', originalColor);
            }
        };
    }, [color, originalColor]);
};
