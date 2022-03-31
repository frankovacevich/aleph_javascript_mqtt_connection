
## Building from source
tsc src/mqtt_namespace_connection.ts
browserify src/mqtt_namespace_connection.js -s aleph -p tinyify -o dist/mqtt_namespace_connection.js
