import { useState, useEffect } from 'react';

export function calculateScrollPercentage() {
    const h = document.documentElement;
    const b = document.body;
    const st = 'scrollTop';
    const sh = 'scrollHeight';

    return ((h[st] || b[st]) / ((h[sh] || b[sh]) - h.clientHeight)) * 100;
}

export function useScrollPercentage() {
    const [scrollPercentage, setScrollPercentage] = useState(
        calculateScrollPercentage(),
    );

    useEffect(() => {
        const updateScrollPercentage = () => {
            setScrollPercentage(calculateScrollPercentage());
        };

        window.addEventListener('scroll', updateScrollPercentage);

        return () => {
            window.removeEventListener('scroll', updateScrollPercentage);
        };
    }, []);

    return scrollPercentage;
}
