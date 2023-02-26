import * as MUI from '@mui/material';
import YouTubeIcon from '@mui/icons-material/YouTube';
import TwitterIcon from '@mui/icons-material/Twitter';

const avatar = "https://pbs.twimg.com/profile_images/1382846958159663105/ltolfDyQ_400x400.jpg";

const name = "Louis Rossmann";

const description = "Apple and Apple Accesories";

export function App() {
    return (
        <div
            style={{
                position: 'absolute',
                left: '0px',
                top: '0px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
            }}
        >
            <div
                style={{
                    marginTop: '20px',
                    width: '33%',
                    display: 'flex',
                    alignItems: 'center',
                    flexDirection: 'column',
                }}
            >
                <MUI.Avatar
                    src={avatar}
                    style={{
                        display: 'block',
                        width: '100px',
                        height: '100px',
                    }}
                />

                <p>
                    {name}
                </p>

                <p>
                    {description}
                </p>

                <MUI.Paper
                    elevation={3}
                    style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginBottom: '20px',
                        paddingLeft: '10px',
                    }}
                >
                    <YouTubeIcon />
                    <p
                        style={{
                            flex: '1',
                            textAlign: 'center',
                        }}
                    >
                        YouTube
                    </p>
                </MUI.Paper>

                <MUI.Paper
                    elevation={3}
                    style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingLeft: '10px',
                    }}
                >
                    <TwitterIcon />
                    <p
                        style={{
                            flex: '1',
                            textAlign: 'center',
                        }}
                    >
                        Twitter
                    </p>
                </MUI.Paper>
            </div>
        </div>
    );
}
