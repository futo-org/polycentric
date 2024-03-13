import './animation.css';

const CircleSpinners = ({
    n,
    radius,
    miniCircleRadius,
}: {
    n: number;
    radius: number;
    miniCircleRadius: number;
}) => {
    const obj = [];

    for (let i = 0; i < n; ++i) {
        const deg = (360 / n) * i;

        const colors = [
            'rgb(186 230 253)',
            'rgb(125 211 252)',
            'rgb(56 189 248)',
            'rgb(14 165 233)',
            'rgb(2 132 199)',
            'rgb(3 105 161)',
        ];
        let index = i % (colors.length * 2);
        // triangle wave
        if (index >= colors.length)
            index = colors.length - (index - colors.length) - 1;
        const color = colors[index];

        obj.push(
            <div
                style={{
                    position: 'absolute',
                    transform: `rotate(${deg}deg)`,
                    height: radius * 2,
                    marginTop: -radius,
                    display: 'flex',
                    flexDirection: 'column',
                }}
                key={`${i}-${radius}`}
            >
                <div
                    style={{
                        position: 'absolute',
                        height: radius,
                        animation: 'spinloaderrotation 4s infinite linear',
                    }}
                >
                    <div
                        style={{
                            width: miniCircleRadius,
                            opacity: 0.8,
                            height: miniCircleRadius,
                            backgroundColor: color,
                            borderRadius: '100%',
                        }}
                    />
                </div>
            </div>,
        );
    }

    return <>{obj}</>;
};

export const SpinLoader = ({ n = 6 }: { n?: number }) => {
    return (
        <div className="relative" style={{ height: '200px', width: '200px' }}>
            <div
                className="left-1/2 top-1/2 relative  w-0 h-0 animate-spin ease"
                style={{
                    animation: 'spinloaderrotation 2s infinite ease-in-out',
                }}
            >
                <CircleSpinners n={n} radius={40} miniCircleRadius={20} />{' '}
            </div>
        </div>
    );
};
