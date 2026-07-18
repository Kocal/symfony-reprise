import React from 'react';

const step = 1;

export function Counter() {
    const [count, setCount] = React.useState(0);

    return (
        <>
            Counter: {count}
            <button type="button" onClick={() => setCount(count - step)}>-</button>
            <button type="button" onClick={() => setCount(count + step)}>+</button>
        </>
    )
}
