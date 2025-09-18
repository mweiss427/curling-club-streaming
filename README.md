# curling-club-streaming
Configuration and Technical Documentation for the Stevens Point Curling Clubs Streaming

Secrets management (.env)
-------------------------

Create a .env file on each OBS machine (not committed) and point the push script to it with -EnvPath, or place it at one of these auto-discovered locations:

- <repo>/.env.<sheet>.local
- <repo>/.env.local
- %USERPROFILE%/.curling-club-streaming/.env.<sheet>
- %USERPROFILE%/.curling-club-streaming/.env

Recommended variables:

- OBS_INPUT_NEAR_WALL=rtsp://username:password@192.168.1.47:554/h264Preview_01_main
- OBS_INPUT_NEAR_HOUSE=rtsps://192.168.1.30:7441/etQ4c6ZW4tjeAAmK?enableSrtp
- OBS_INPUT_FAR_WALL=rtsp://username:password@192.168.1.42:554/h264Preview_01_main
- OBS_INPUT_FAR_HOUSE=rtsps://192.168.1.30:7441/LCDrHl0s3t7s7jFP?enableSrtp

Fallbacks (used only if a per-source override is missing):

- OBS_RTSP_USERNAME=yourUser
- OBS_RTSP_PASSWORD=yourPass

Usage:

powershell -ExecutionPolicy Bypass -File tools\push-obs-configs.ps1 -Sheet sheet-a -EnvPath C:\\path\\to\\.env
