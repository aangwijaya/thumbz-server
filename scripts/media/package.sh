#!/usr/bin/env bash
# Packages a video for protected streaming:
#   - DASH, CENC-encrypted (cenc), with a W3C common PSSH -> ClearKey via EME
#     (Chrome/Edge/Firefox); the same encryption works with Widevine/PlayReady
#     when a commercial license service holds the key.
#   - HLS, AES-128 segment encryption -> plays natively on Safari/iOS.
# Two renditions (720p, 360p) for adaptive bitrate.
#
# Usage: scripts/media/package.sh <name> [source.mp4] [output-dir]
#   Without a source, a 60 s synthetic test clip is generated (no licensing).
# Tools: FFMPEG / PACKAGER env vars, else `ffmpeg` / `packager` on PATH
#   (shaka-packager: https://github.com/shaka-project/shaka-packager/releases).
# Output: <output-dir>/<name>/{dash,hls}/... and asset.json (contains the KEY:
#   keep it out of git; scripts/media/register.ts stores it encrypted).
set -euo pipefail

NAME="${1:?usage: package.sh <name> [source.mp4] [output-dir]}"
SOURCE="${2:-}"
OUT_ROOT="${3:-media-out}"
FFMPEG="${FFMPEG:-ffmpeg}"
PACKAGER="${PACKAGER:-packager}"
OUT="$OUT_ROOT/$NAME"
WORK="$OUT/.work"
rm -rf "$OUT" && mkdir -p "$WORK" "$OUT/dash" "$OUT/hls/720" "$OUT/hls/360"

if [ -z "$SOURCE" ]; then
  SOURCE="$WORK/source.mp4"
  "$FFMPEG" -hide_banner -loglevel error \
    -f lavfi -i "testsrc2=size=1280x720:rate=30" \
    -f lavfi -i "sine=frequency=330:sample_rate=48000" \
    -t 60 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$SOURCE"
fi

KEY="$(openssl rand -hex 16)"
KID="$(openssl rand -hex 16)"
IV="$(openssl rand -hex 16)"

# Aligned 2 s GOPs so every rendition switches cleanly (ABR).
encode() { # height bitrate out
  "$FFMPEG" -hide_banner -loglevel error -i "$SOURCE" \
    -map 0:v:0 -map 0:a:0? -vf "scale=-2:$1" \
    -c:v libx264 -profile:v main -preset veryfast -b:v "$2" -maxrate "$2" -bufsize "$2" \
    -g 60 -keyint_min 60 -sc_threshold 0 -c:a aac -b:a 128k -ac 2 \
    -movflags +faststart "$3"
}
encode 720 2500k "$WORK/720.mp4"
encode 360 800k "$WORK/360.mp4"

# --- DASH + CENC (ClearKey-compatible) ------------------------------------
"$PACKAGER" \
  "in=$WORK/720.mp4,stream=video,init_segment=$OUT/dash/v720/init.mp4,segment_template=$OUT/dash/v720/\$Number\$.m4s" \
  "in=$WORK/360.mp4,stream=video,init_segment=$OUT/dash/v360/init.mp4,segment_template=$OUT/dash/v360/\$Number\$.m4s" \
  "in=$WORK/720.mp4,stream=audio,init_segment=$OUT/dash/audio/init.mp4,segment_template=$OUT/dash/audio/\$Number\$.m4s" \
  --enable_raw_key_encryption \
  --keys "label=:key_id=$KID:key=$KEY" \
  --protection_scheme cenc \
  --protection_systems CommonSystem \
  --clear_lead 0 \
  --segment_duration 4 \
  --generate_static_live_mpd \
  --mpd_output "$OUT/dash/manifest.mpd" >/dev/null

# Packager writes absolute-ish paths into the MPD; keep them relative.
sed -i "s#$OUT/dash/##g" "$OUT/dash/manifest.mpd"

# --- HLS + AES-128 --------------------------------------------------------
printf '%s' "$KEY" | xxd -r -p > "$WORK/key.bin"
# Key URI placeholder: the API's manifest proxy rewrites it per playback session.
printf 'thumbz-key://%s\n%s\n%s\n' "$KID" "$WORK/key.bin" "$IV" > "$WORK/keyinfo"
hls() { # rendition
  "$FFMPEG" -hide_banner -loglevel error -i "$WORK/$1.mp4" -c copy -bsf:v h264_mp4toannexb \
    -hls_time 4 -hls_playlist_type vod -hls_key_info_file "$WORK/keyinfo" \
    -hls_segment_filename "$OUT/hls/$1/%03d.ts" "$OUT/hls/$1/index.m3u8"
}
hls 720
hls 360
cat > "$OUT/hls/master.m3u8" <<M3U8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=950000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360/index.m3u8
M3U8

DURATION="$("${FFPROBE:-${FFMPEG%ffmpeg}ffprobe}" -v error -show_entries format=duration -of csv=p=0 "$WORK/720.mp4" | cut -d. -f1)"
cat > "$OUT/asset.json" <<JSON
{ "name": "$NAME", "kid": "$KID", "key": "$KEY", "dash": "dash/manifest.mpd", "hls": "hls/master.m3u8", "duration_seconds": $DURATION }
JSON
rm -rf "$WORK"
echo "packaged $OUT (kid $KID)"
