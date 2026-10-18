#!/bin/sh
# Turn the Car Thing screen off after a period without touch, knob or buttons,
# and back on at the first input.
#
# Usage: screen-idle.sh <timeout-seconds>   (0 = never turn off)
# Lives in /var/screen-idle (the root filesystem is read-only); started over
# adb by the Pi Status DeskThing app.

TIMEOUT=${1:-300}
BL=/sys/class/backlight/aml-bl
RUN=/tmp/screen-idle
PIDFILE=$RUN/pid
MAIN=$$

mkdir -p "$RUN"

# single instance: stop any previous copy (e.g. after a timeout change) and
# its input readers. Forked readers show the same command line as the script.
for p in $(ps | awk '$4 == "sh" && $5 == "/var/screen-idle/screen-idle.sh" {print $1}'); do
	[ "$p" != "$$" ] && kill "$p" 2>/dev/null
done
# input readers left behind by a previous copy (blocked in head)
for p in $(ps -o pid,args | awk '$2 == "head" && $5 ~ /^\/dev\/input\// {print $1}'); do
	kill "$p" 2>/dev/null
done
sleep 2
echo $$ > "$PIDFILE"
echo "$TIMEOUT" > "$RUN/timeout"
echo 2 > "$RUN/version" # bump with every change: the app restarts older copies

# "last activity" is written by several processes (readers, the PC over adb):
# write it atomically and never trust what we read back.
touch_last() {
	date +%s > "$RUN/last.$1" && mv -f "$RUN/last.$1" "$RUN/last"
}
read_last() {
	l=$(cat "$RUN/last" 2>/dev/null)
	case "$l" in
		'' | *[!0-9]*) echo "$1" ;;
		*) echo "$l" ;;
	esac
}

touch_last main
off=0
saved=""

screen_on() {
	case "$saved" in '' | 0 | *[!0-9]*) ;; *) echo "$saved" > $BL/brightness ;; esac
	echo 0 > $BL/bl_power
	# hand brightness back to the ambient-light service
	supervisorctl start backlight >/dev/null 2>&1
	off=0
}

screen_off() {
	# the ambient-light service would turn the screen straight back on
	supervisorctl stop backlight >/dev/null 2>&1
	saved=$(cat $BL/brightness)
	echo 0 > $BL/brightness
	echo 4 > $BL/bl_power
	off=1
}

cleanup() {
	[ "$off" = 1 ] && screen_on
	kill $READERS 2>/dev/null
	# only remove the pid file if it is still ours
	[ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ] && rm -f "$PIDFILE"
	exit 0
}
trap cleanup INT TERM HUP

# a copy started while the screen was off (previous one killed hard) must
# not leave it dark
echo 0 > $BL/bl_power
supervisorctl start backlight >/dev/null 2>&1

# One reader per input device (buttons, knob, keypad, touch): every event
# refreshes the "last activity" timestamp. Reading does not steal events.
# A reader quits as soon as the main script is gone.
READERS=""
n=0
for dev in /dev/input/event*; do
	n=$((n + 1))
	(
		while kill -0 "$MAIN" 2>/dev/null; do
			head -c 24 "$dev" > /dev/null 2>&1 || sleep 2
			touch_last "r$n"
		done
	) &
	READERS="$READERS $!"
done

while true; do
	now=$(date +%s)
	last=$(read_last "$now")
	idle=$((now - last))
	if [ "$off" = 0 ] && [ "$TIMEOUT" -gt 0 ] && [ "$idle" -ge "$TIMEOUT" ]; then
		screen_off
	elif [ "$off" = 1 ] && [ "$idle" -lt "$TIMEOUT" ]; then
		screen_on
	fi
	sleep 1
done
