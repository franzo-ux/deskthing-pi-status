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

mkdir -p "$RUN"

# single instance: stop any previous copy (e.g. after a timeout change)
# and wait for it to restore the screen before taking over
for p in $(ps | awk '$4 == "sh" && $5 == "/var/screen-idle/screen-idle.sh" {print $1}'); do
	[ "$p" != "$$" ] && kill "$p" 2>/dev/null
done
# input readers left behind by a previous copy (blocked in head, parent gone)
for p in $(ps -o pid,ppid,args | awk '$2 == 1 && $3 == "head" && $6 ~ /^\/dev\/input\// {print $1}'); do
	kill "$p" 2>/dev/null
done
sleep 2
echo $$ > "$PIDFILE"
echo "$TIMEOUT" > "$RUN/timeout"

date +%s > "$RUN/last"
off=0
saved=""

screen_on() {
	[ -n "$saved" ] && echo "$saved" > $BL/brightness
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
trap cleanup INT TERM

# One reader per input device (buttons, knob, keypad, touch): every event
# refreshes the "last activity" timestamp. Reading does not steal events.
READERS=""
for dev in /dev/input/event*; do
	(
		while true; do
			head -c 24 "$dev" > /dev/null 2>&1 || sleep 2
			date +%s > "$RUN/last"
		done
	) &
	READERS="$READERS $!"
done

while true; do
	now=$(date +%s)
	last=$(cat "$RUN/last" 2>/dev/null || echo "$now")
	idle=$((now - last))
	if [ "$off" = 0 ] && [ "$TIMEOUT" -gt 0 ] && [ "$idle" -ge "$TIMEOUT" ]; then
		screen_off
	elif [ "$off" = 1 ] && [ "$idle" -lt "$TIMEOUT" ]; then
		screen_on
	fi
	sleep 1
done
