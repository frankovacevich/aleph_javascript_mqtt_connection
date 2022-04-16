import * as mqtt from "../node_modules/mqtt/mqtt.js";


export class MqttNamespaceConnection{
    client_id: string;
    default_time_step: number;
    clean_on_write: boolean;

    read_timeout: number;
    last_will_message: any;
    last_will_key: any;
    birth_message: any;
    birth_key: any;
    use_tls: boolean;
    port: number;
    broker_address: string;
    password: string;
    username: string;

    mqtt_client;
    private __unsubscribe_flags__ = {};
    private __read_request_topic__ = null;
    private __read_request_data__ = null;

    constructor(client_id:string){

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

    open(): Promise<void>{
        this.open_async();

        return new Promise((resolve, reject) => {
            
            let tout = setTimeout(() => {
                clearInterval(tint);
                clearTimeout(tout);
                reject(Error("Timeout"));
            }, this.read_timeout * 1000);

            let tint = setInterval(() => {
                if(this.is_connected()){
                    clearInterval(tint);
                    clearTimeout(tout);
                    resolve();
                }
            }, 500);
        });

    }

    open_async(): void{
        if(this.mqtt_client != null){ return; }

        // Get options
        let options = {
            connectTimeout: this.read_timeout * 1000,
            clientId: this.client_id,
            username: this.username,
            password: this.password,
        }

        if(this.last_will_key != null && this.last_will_message != null){
            options["will"] = {
                "topic": this.key_to_topic(this.last_will_key),
                "payload": this.data_to_mqtt_message(this.last_will_message),
                "qos": 1,
            }
        }

        // Get server address
        let host = this.broker_address;
        if(this.broker_address == ""){
            if(typeof window !== "undefined") { host = window.location.hostname; }
            else{ host = "localhost" }
        }
        if(this.use_tls){
            host = "wss://" + host;
        } else {
            host = "ws://" + host;
        }
        host = host + ":" + this.port.toString();

        // Connect
        this.mqtt_client = mqtt.connect(host, options);
        
        // Callbacks
        var __this__ = this;
        this.mqtt_client.on("connect", function(){ 
            if(__this__.birth_key != null && __this__.birth_message != null){
                __this__.write(__this__.birth_key, __this__.birth_message);
            }
            __this__.on_connect();
        });

        this.mqtt_client.on("offline", function(){ 
            __this__.on_disconnect();
        });

        this.mqtt_client.on("message", function(topic: string, message: string){ 
            __this__.__on_new_mqtt_message__(topic, message) 
        });
    }

    close(): void{ 
        if(this.mqtt_client == null){ return; }
        this.mqtt_client.end();
    }

    is_connected(): boolean{ 
        if(this.mqtt_client == null){ return false; }
        return this.mqtt_client.connected;
    }

    // open_async(time_step: number=null): void{
    //     this.__open__();
    // }
    
    // ==============================================================================
    // Read and write
    // ==============================================================================

    read(key: string, args: object = {}): Promise<object>{ 

        return new Promise((resolve, reject) => {

            // Create response listener
            const response_listener = () => {
                let tint = setInterval(() => {
                    if(this.__read_request_data__ != null){
                        this.mqtt_client.removeListener("message", response_listener);
                        clearInterval(tint);
                        resolve(this.__read_request_data__);
                    }
                }, 500);
            }

            // Generate timeout
            let tout = setTimeout(() => {
                clearTimeout(tout);
                this.mqtt_client.removeListener("message", response_listener);
                reject(Error("Timeout"))
            }, 1000 * this.read_timeout);

            // add listener
            this.mqtt_client.on("message", response_listener);

            // Send read request
            this.__generate_read_request__(key, args);
        });
    }

    safe_read(key: string, args: object): Promise<object>{ 
        
        return new Promise((resolve, reject) => {
            if(!(this.mqtt_client.connected)){
                this.on_read_error(Error("Client not connected"));
                resolve(null);
            }

            this.read(key, args).then((data) => {
                if(data === null){
                    resolve(null);
                    this.on_read_error(Error("Remote service error"))
                }

                let cleaned_data = this.__clean_read_data__(key, data);
                resolve(cleaned_data);
            }).catch((err) => {
                this.on_read_error(err)
                resolve(null);
            })
        });
    }

    write(key: string, data: object): Promise<void>{
        return new Promise((resolve, reject) => {
            let topic = this.key_to_topic(key);
            let message = this.data_to_mqtt_message(data);
            let options = {"qos": 1,};

            this.mqtt_client.publish(topic, message, options, (err, result) => {
                if(err){ reject() }
                else{ resolve() }
            });
        })
    }

    safe_write(key: string, data: object): Promise<boolean>{
        return new Promise((resolve, reject) => {

            if(!(this.mqtt_client.connected)){
                this.on_write_error(Error("Client not connected"));
                resolve(false);
            }

            // Clean data
            data = this.__clean_write_data__(key, data);

            this.write(key, data).then((result) => {
                resolve(true);
            }).catch((err) => {
                this.on_write_error(err)
                resolve(false);
            })

        });
    }

    // More reading functions
    subscribe(key: string, time_step: number=null): void{
        let topic = this.key_to_topic(key);
        this.mqtt_client.subscribe(topic);
    }

    read_async(key: string, args: object): void{
        this.__generate_read_request__(key, args);
    }
    
    subscribe_async(key: string, time_step: number=null): void{
        let topic = this.key_to_topic(key);
        this.mqtt_client.subscribe(topic);
    }
    
    unsubscribe(key: string): void{
        let topic = this.key_to_topic(key);
        this.mqtt_client.unsubscribe(topic);
    }

    // ==============================================================================
    // Callbacks
    // ==============================================================================
    on_connect(): void{ return; }
    on_disconnect(): void{ return; }
    on_new_data(key: string, data: object): void{ return; }
    on_read_error(error: any): void{ return; }
    on_write_error(error: any): void{ return; }

    // ==============================================================================
    // Aux
    // ==============================================================================

    // Generate read request 
    __generate_read_request__(key: string, args: object): number{

        // create request message
        let response_code = Math.floor(Math.random() * 1E9)

        // add parameters
        let request = args;
        // request["cleaned"] = true;
        request["response_code"] = response_code;
        request["t"] = Date.now() / 1000;

        // get topic and message
        let topic = this.key_to_topic(key, "r");
        let message = this.data_to_mqtt_message(request);

        // subscribe to response
        this.__read_request_topic__ = this.key_to_topic(key, response_code.toString());
        this.mqtt_client.subscribe(this.__read_request_topic__);

        // publish request
        this.mqtt_client.publish(topic, message);

        // return response topic
        return response_code;
    }

    // Mqtt message handling
    __on_new_mqtt_message__(topic: string, message: string){
        try{
            let key = this.topic_to_key(topic);
            let data = this.mqtt_message_to_data(message);
            
            if(data === null){ throw Error("Remote service error"); }

            if(topic == this.__read_request_topic__){
                this.__read_request_data__ = data;
                this.mqtt_client.unsubscribe(this.__read_request_topic__);
            } else {
                this.on_new_data(key, data);
            }

        } catch(error){
            this.on_read_error(error);
        }
    }

    // Cleaning
    __clean_read_data__(key: string, data: object): object{
        if(!Array.isArray(data)){ return [data]; }
        else{ return data; }
    }

    __clean_write_data__(key: string, data: any): object{ 
        if(!Array.isArray(data)){ data = [data]; }

        let cleaned_data = [];
        for(let record of data){
            // see if t in record
            if(!("t" in record)){ record["t"] = (new Date()).toISOString(); }
            else{ record["t"] = (new Date(record["t"])).toISOString(); }

            // flatten
            // TODO

            // report by exception
            // TODO

            // check if not empty
            if(!this.__check_record_is_not_empty__(record)){ continue; }
            
            // add to cleaned
            cleaned_data.push(record);
        }

        return cleaned_data;
    }
    
    __check_record_is_not_empty__(record: object): boolean { 
        let count = 0;
        for(let item in record){
            if(item != "t" && item != "t_" && item != "id_" && item != "ignore_"){
                count ++;
            }
        }
        return count > 0;
    }
    
    // Topic to key and others
    topic_to_key(topic: string): string{
        if(topic.startsWith("alv1") && topic.length > 7){
            let s_index = topic.indexOf("/", 5) + 1;
            topic = topic.substring(s_index);
        }
        return topic.replace(/\//g, ".");
    }

    key_to_topic(key: string, mode: string="w"): string{
        let topic = "alv1/" + mode + "/" + key.replace(/\./g, "/");
        return topic;
    }

    data_to_mqtt_message(data: object): string{
        return JSON.stringify(data);
    }

    mqtt_message_to_data(message: string): object{
        return JSON.parse(message);
    }

}

