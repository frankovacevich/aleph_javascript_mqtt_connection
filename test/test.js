//import { MqttNamespaceConnection } from "../src/mqtt_namespace_connection.js";
var q = require("../src/mqtt_namespace_connection.js");


let Q = new q.MqttNamespaceConnection("ME");
Q.port = 8883;
Q.broker_address = "localhost";
Q.use_tls = false;

console.log(Q.is_connected());
Q.open();

Q.on_read_error = console.log;

setTimeout(() => {
    Q.safe_read("tonutti.planta.produccion.sala_blandos.tinas.registro", 
    {since:null, until:null, limit:10}
    ).then(console.log).catch((err) => console.log("ERR", err))    
}, 1000);

//setInterval(() => console.log(Q.is_connected()), 1000)