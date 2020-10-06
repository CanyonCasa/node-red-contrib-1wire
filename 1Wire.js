/**
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {

  function Wirenode(n) {
    RED.nodes.createNode(this,n);
	  this.identifier = n.identifier.trim();
	  this.format = n.format;
	  var node = this;
    var fsp = require("fs").promises;
    const exec = require('util').promisify(require('child_process').exec);

    node.on("input", function(msg,send,done) {
      (async () => {
        let identifier = this.identifier || msg.topic || '';  // identifier overrides topic
        let topic = node.name || msg.topic || identifier;  // topic default
        let showStatus = (f,s,t) => node.status({fill:f||'red',style:s||'ring',text:t||identifier+': NA'});
        let filebase = "/sys/bus/w1/devices/" + identifier;
        let family = identifier.substring(0,2).toLowerCase();
        // check family code to address different supported device types...
        if (['10','22','28','3b','42'].includes(family)) {
          // DS18B20 temperature sensor...
          try {
            let data = await fsp.readFile(filebase+"/w1_slave","utf8");
            let raw = data.split(' ').slice(0,9);
            // check for good CRC (YES) and parse t=temp...
            let temp = (data.match(/YES\n[^t]+t=(-*\d+)/)||[])[1];
            if (temp===undefined) throw "Bad CRC detected!";
            // format and send good data only...
            temp = (this.format==1) ? temp/1000 : (temp/1000 * 9/5) + 32; // C or F
            showStatus("blue","ring",identifier+': '+temp.toFixed(3));
            send({topic: topic, payload: temp, raw: raw});
            done();
          } catch(e) {
            node.warn("Wirenode Temp Error: "+e.toString());
            showStatus();
            done();
          };
        } else if (['3a'].includes(family)) {
          // DS2413 2-bit I/O port...
          // DS2413 I/O port... write => {a:<1|0>, b:<1|0>} or [b,a] OR read => timestamp
          let bit = v => v ? 1 : 0;
          let parse = p => ({ latchB: bit(p&0x8), pioB: bit(p&0x4), latchA: bit(p&0x2), pioA: bit(p&0x1) });
          let fv = function firstValid() { return Array.from(arguments).find(e => e!==undefined); };
          let port;
          try {
            // first get current port state, parse, and check
            port = (await fsp.readFile(filebase+"/state"))[0]&0xFF;  // input as Buffer[1]
            if (((~port&0xF0)>>4)!==(port&0xF)) throw "Bad Port Read";
          } catch(e) {
            node.warn("Wirenode Port Read Error: "+e.toString());
            showStatus();
            done();
          };
          if (typeof msg.payload!=='object') { // just read
            send({ topic: topic, payload: parse(port) });
            showStatus("blue","ring",identifier+': '+'0x'+port.toString(16).toUpperCase());
            done();
          } else { // write using read values for defaults as needed and verify...
            let old = parse(port);
            let [oldB,oldA] = [old.latchB,old.latchA]; // defaults
            let [b,a] = (msg.payload instanceof Array) ? [fv(msg.payload[1],oldB),fv(msg.payload[0],oldA)] :
              [fv(msg.payload.b,msg.payload.B,oldB),fv(msg.payload.a,msg.payload.A,oldA)];
            try {
              //await fsp.writeFile(filebase+'/output',String.fromCharCode((b<<1)+a),"utf8");
              // workaround using script because output must be done as root... 
              // script defined to not require password in sudoer file!
              await exec(`sudo /usr/local/bin/ds2413 w ${identifier} ${a} ${b}`);
              port = (await fsp.readFile(filebase+"/state"))[0]&0xFF;
              if (((~port&0xF0)>>4)!==(port&0xF)) throw "Bad Port Verify";
              send({ topic: topic, payload: parse(port) });
              showStatus("green","ring",identifier+': '+'0x'+port.toString(16).toUpperCase());
              done();
            } catch (e) {
              node.warn("Wirenode Port Write Error: "+e.toString());
              showStatus();
              done();
            };
          };
        } else {
          /// TBD...
          send({ topic: topic, payload: "TBD" });
          // Add generic support...
          showStatus();
          done();
        };
      })();
    });
  };
  RED.nodes.registerType("1-Wire",Wirenode);
}
