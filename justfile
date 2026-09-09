export ANDROID_HOME := env('ANDROID_HOME', env('ANDROID_SDK_ROOT', home_directory() + '/Android/Sdk'))
export PATH := ANDROID_HOME + '/platform-tools:' + env('PATH')

# Build, install, and open the Android development app on a selected device.
android:
    npx expo run:android --device

# Start Metro for an already-installed development build.
start:
    npm start

# Reconnect a paired phone using its current Wireless debugging IP:port.
connect address:
    adb connect {{quote(address)}}
