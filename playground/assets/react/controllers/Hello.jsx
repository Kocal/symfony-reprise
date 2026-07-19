import React from 'react';
import {Counter} from '../Counter.jsx';

export default function (props) {
    return <div>
        <div>Hello {props.fullName} (rendered by UX React)!</div>
        <Counter />
    </div>;
}
