export function numberTo4Chars(num: number) {
    // 5 -> 5
    // 4300 -> 4.3k
    // 123456 -> 123k
    // 1234567 -> 1.2m
    // 12345678 -> 12m
    // 123456789 -> 123m
    // 1234567890 -> 1.2b
    if (num < 10000) {
        return num.toString();
    } else if (num < 1000000) {
        return (num / 1000).toFixed(0) + 'k';
    } else if (num < 1000000000) {
        return (num / 1000000).toFixed(0) + 'm';
    } else {
        return (num / 1000000000).toFixed(0) + 'b';
    }
}

export function getFullPath() {
    return window.location.href.replace(window.location.origin, '');
}
