"use strict";
exports.__esModule = true;
exports.MqttNamespaceConnection = void 0;
var mqtt = require("../node_modules/mqtt/mqtt.js");
var MqttNamespaceConnection = /** @class */ (function () {
    function MqttNamespaceConnection(client_id) {
        this.__unsubscribe_flags__ = {};
        this.__read_request_topic__ = null;
        this.__read_request_data__ = null;
        this.mqtt_client = null;
        // Main connection attributes
        this.client_id = client_id;
        this.default_time_step = 10;
        this.clean_on_write = true;
        // Mqtt attributes
        this.username = "";
        this.password = "";
        this.broker_address = "";
        this.port = 1883;
        this.use_tls = true;
        // Birth and last will
        this.birth_key = null;
        this.birth_message = null;
        this.last_will_key = null;
        this.last_will_message = null;
        this.read_timeout = 10;
        // Aux flags
        this.__unsubscribe_flags__ = {};
        this.__read_request_topic__ = null;
        this.__read_request_data__ = null;
    }
    // ==============================================================================
    // Open and close
    // ==============================================================================
    MqttNamespaceConnection.prototype.open = function () {
        var _this = this;
        this.open_async();
        return new Promise(function (resolve, reject) {
            var tout = setTimeout(function () {
                clearInterval(tint);
                clearTimeout(tout);
                reject(Error("Timeout"));
            }, _this.read_timeout * 1000);
            var tint = setInterval(function () {
                if (_this.is_connected()) {
                    clearInterval(tint);
                    clearTimeout(tout);
                    resolve();
                }
            }, 500);
        });
    };
    MqttNamespaceConnection.prototype.open_async = function () {
        if (this.mqtt_client != null) {
            return;
        }
        // Get options
        var options = {
            connectTimeout: this.read_timeout * 1000,
            clientId: this.client_id,
            username: this.username,
            password: this.password
        };
        if (this.last_will_key != null && this.last_will_message != null) {
            options["will"] = {
                "topic": this.key_to_topic(this.last_will_key),
                "payload": this.data_to_mqtt_message(this.last_will_message),
                "qos": 1
            };
        }
        // Get server address
        var host = this.broker_address;
        if (this.broker_address == "") {
            if (typeof window !== "undefined") {
                host = window.location.hostname;
            }
            else {
                host = "localhost";
            }
        }
        if (this.use_tls) {
            host = "wss://" + host;
        }
        else {
            host = "ws://" + host;
        }
        host = host + ":" + this.port.toString();
        // Connect
        this.mqtt_client = mqtt.connect(host, options);
        // Callbacks
        var __this__ = this;
        this.mqtt_client.on("connect", function () {
            if (__this__.birth_key != null && __this__.birth_message != null) {
                __this__.write(__this__.birth_key, __this__.birth_message);
            }
            __this__.on_connect();
        });
        this.mqtt_client.on("offline", function () {
            __this__.on_disconnect();
        });
        this.mqtt_client.on("message", function (topic, message) {
            __this__.__on_new_mqtt_message__(topic, message);
        });
    };
    MqttNamespaceConnection.prototype.close = function () {
        if (this.mqtt_client == null) {
            return;
        }
        this.mqtt_client.end();
    };
    MqttNamespaceConnection.prototype.is_connected = function () {
        if (this.mqtt_client == null) {
            return false;
        }
        return this.mqtt_client.connected;
    };
    // open_async(time_step: number=null): void{
    //     this.__open__();
    // }
    // ==============================================================================
    // Read and write
    // ==============================================================================
    MqttNamespaceConnection.prototype.read = function (key, args) {
        var _this = this;
        if (args === void 0) { args = {}; }
        return new Promise(function (resolve, reject) {
            // Create response listener
            var response_listener = function () {
                var tint = setInterval(function () {
                    if (_this.__read_request_data__ != null) {
                        _this.mqtt_client.removeListener("message", response_listener);
                        clearInterval(tint);
                        resolve(_this.__read_request_data__);
                    }
                }, 500);
            };
            // Generate timeout
            var tout = setTimeout(function () {
                clearTimeout(tout);
                _this.mqtt_client.removeListener("message", response_listener);
                reject(Error("Timeout"));
            }, 1000 * _this.read_timeout);
            // add listener
            _this.mqtt_client.on("message", response_listener);
            // Send read request
            _this.__generate_read_request__(key, args);
        });
    };
    MqttNamespaceConnection.prototype.safe_read = function (key, args) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (!(_this.mqtt_client.connected)) {
                _this.on_read_error(Error("Client not connected"));
                resolve(null);
            }
            _this.read(key, args).then(function (data) {
                if (data === null) {
                    resolve(null);
                    _this.on_read_error(Error("Remote service error"));
                }
                var cleaned_data = _this.__clean_read_data__(key, data);
                resolve(cleaned_data);
            })["catch"](function (err) {
                _this.on_read_error(err);
                resolve(null);
            });
        });
    };
    MqttNamespaceConnection.prototype.write = function (key, data) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var topic = _this.key_to_topic(key);
            var message = _this.data_to_mqtt_message(data);
            var options = { "qos": 1 };
            _this.mqtt_client.publish(topic, message, options, function (err, result) {
                if (err) {
                    reject();
                }
                else {
                    resolve();
                }
            });
        });
    };
    MqttNamespaceConnection.prototype.safe_write = function (key, data) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (!(_this.mqtt_client.connected)) {
                _this.on_write_error(Error("Client not connected"));
                resolve(false);
            }
            // Clean data
            data = _this.__clean_write_data__(key, data);
            _this.write(key, data).then(function (result) {
                resolve(true);
            })["catch"](function (err) {
                _this.on_write_error(err);
                resolve(false);
            });
        });
    };
    // More reading functions
    MqttNamespaceConnection.prototype.subscribe = function (key, time_step) {
        if (time_step === void 0) { time_step = null; }
        var topic = this.key_to_topic(key);
        this.mqtt_client.subscribe(topic);
    };
    MqttNamespaceConnection.prototype.read_async = function (key, args) {
        this.__generate_read_request__(key, args);
    };
    MqttNamespaceConnection.prototype.subscribe_async = function (key, time_step) {
        if (time_step === void 0) { time_step = null; }
        var topic = this.key_to_topic(key);
        this.mqtt_client.subscribe(topic);
    };
    MqttNamespaceConnection.prototype.unsubscribe = function (key) {
        var topic = this.key_to_topic(key);
        this.mqtt_client.unsubscribe(topic);
    };
    // ==============================================================================
    // Callbacks
    // ==============================================================================
    MqttNamespaceConnection.prototype.on_connect = function () { return; };
    MqttNamespaceConnection.prototype.on_disconnect = function () { return; };
    MqttNamespaceConnection.prototype.on_new_data = function (key, data) { return; };
    MqttNamespaceConnection.prototype.on_read_error = function (error) { return; };
    MqttNamespaceConnection.prototype.on_write_error = function (error) { return; };
    // ==============================================================================
    // Aux
    // ==============================================================================
    // Generate read request 
    MqttNamespaceConnection.prototype.__generate_read_request__ = function (key, args) {
        // create request message
        var response_code = Math.floor(Math.random() * 1E9);
        // add parameters
        var request = args;
        // request["cleaned"] = true;
        request["response_code"] = response_code;
        request["t"] = Date.now() / 1000;
        // get topic and message
        var topic = this.key_to_topic(key, "r");
        var message = this.data_to_mqtt_message(request);
        // subscribe to response
        this.__read_request_topic__ = this.key_to_topic(key, response_code.toString());
        this.mqtt_client.subscribe(this.__read_request_topic__);
        // publish request
        this.mqtt_client.publish(topic, message);
        // return response topic
        return response_code;
    };
    // Mqtt message handling
    MqttNamespaceConnection.prototype.__on_new_mqtt_message__ = function (topic, message) {
        try {
            var key = this.topic_to_key(topic);
            var data = this.mqtt_message_to_data(message);
            if (data === null) {
                throw Error("Remote service error");
            }
            if (topic == this.__read_request_topic__) {
                this.__read_request_data__ = data;
                this.mqtt_client.unsubscribe(this.__read_request_topic__);
            }
            else {
                this.on_new_data(key, data);
            }
        }
        catch (error) {
            this.on_read_error(error);
        }
    };
    // Cleaning
    MqttNamespaceConnection.prototype.__clean_read_data__ = function (key, data) {
        if (!Array.isArray(data)) {
            return [data];
        }
        else {
            return data;
        }
    };
    MqttNamespaceConnection.prototype.__clean_write_data__ = function (key, data) {
        if (!Array.isArray(data)) {
            data = [data];
        }
        var cleaned_data = [];
        for (var _i = 0, data_1 = data; _i < data_1.length; _i++) {
            var record = data_1[_i];
            // see if t in record
            if (!("t" in record)) {
                record["t"] = (new Date()).toISOString();
            }
            else {
                record["t"] = (new Date(record["t"])).toISOString();
            }
            // flatten
            // TODO
            // report by exception
            // TODO
            // check if not empty
            if (!this.__check_record_is_not_empty__(record)) {
                continue;
            }
            // add to cleaned
            cleaned_data.push(record);
        }
        return cleaned_data;
    };
    MqttNamespaceConnection.prototype.__check_record_is_not_empty__ = function (record) {
        var count = 0;
        for (var item in record) {
            if (item != "t" && item != "t_" && item != "id_" && item != "ignore_") {
                count++;
            }
        }
        return count > 0;
    };
    // Topic to key and others
    MqttNamespaceConnection.prototype.topic_to_key = function (topic) {
        if (topic.startsWith("alv1") && topic.length > 7) {
            var s_index = topic.indexOf("/", 5) + 1;
            topic = topic.substring(s_index);
        }
        return topic.replace(/\//g, ".");
    };
    MqttNamespaceConnection.prototype.key_to_topic = function (key, mode) {
        if (mode === void 0) { mode = "w"; }
        var topic = "alv1/" + mode + "/" + key.replace(/\./g, "/");
        return topic;
    };
    MqttNamespaceConnection.prototype.data_to_mqtt_message = function (data) {
        return JSON.stringify(data);
    };
    MqttNamespaceConnection.prototype.mqtt_message_to_data = function (message) {
        return JSON.parse(message);
    };
    return MqttNamespaceConnection;
}());
exports.MqttNamespaceConnection = MqttNamespaceConnection;
