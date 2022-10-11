import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, ReactNode } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import Post from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';
import ProfileHeader from './ProfileHeader';

type ExploreProps = {
    state: Core.DB.PolycentricState;
};

function Explore(props: ExploreProps) {
    return (
        <div className="standard_width">
        </div>
    );
}

export default Explore;
