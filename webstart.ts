import {BasicREPL} from './repl';
import { Type, Value,Class } from './ast';
import { defaultTypeEnv } from './type-check';
import { NUM, BOOL, NONE } from './utils';
import CodeMirror from "codemirror"


function stringify(typ: Type, arg: any) : string {
  switch(typ.tag) {
    case "number":
      return (arg as number).toString();
    case "bool":
      return (arg as boolean)? "True" : "False";
    case "none":
      return "None";
    case "class":
      return typ.name;
  }
}

function print(typ: Type, arg : number) : any {
  console.log("Logging from WASM: ", arg);
  const elt = document.createElement("pre");
  document.getElementById("output").appendChild(elt);
  elt.innerText = stringify(typ, arg);
  return arg;
}

function assert_not_none(arg: any) : any {
  if (arg === 0)
    throw new Error("RUNTIME ERROR: cannot perform operation on none");
  return arg;
}

function get_code_example(name: string) : string {
  if (name === "basic class") {
    return "class C:\n" +
        "    a : int = 1\n" +
        "    b : int = 2\n" +
        "c : C = None\n" +
        "c = C()"
  } else if (name === "nested class") {
    return "class E(object):\n" +
        "    a : int = 1\n" +
        "class C(object):\n" +
        "    a : bool = True\n" +
        "    e : E = None\n" +
        "    def __init__(self: C):\n" +
        "        self.e = E()\n" +
        "    def d(self: C) -> int:\n" +
        "        return 1\n" +
        "c : C = None\n" +
        "c = C()"
  } else if (name === "uninitialized member variable") {
    return "class E(object):\n" +
        "    a : int = 1\n" +
        "\n" +
        "class C(E):\n" +
        "    a : int = 2\n" +
        "    e : E = None\n" +
        "    def d(self: C) -> int:\n" +
        "        return 1\n" +
        "c : C = None\n" +
        "c = C()"
  }

  return "";
}

function webStart() {
  document.addEventListener("DOMContentLoaded", async function() {

    // https://github.com/mdn/webassembly-examples/issues/5
    var codeContent: string | ArrayBuffer
    const memory = new WebAssembly.Memory({initial:10, maximum:100});
    const memoryModule = await fetch('memory.wasm').then(response => 
      response.arrayBuffer()
    ).then(bytes => 
      WebAssembly.instantiate(bytes, { js: { mem: memory } })
    );
    
    function console_log_class(repl:BasicREPL, pointer:number, classname:string,level:number,met_object: Map<number,number>,object_number:number) : Array<string>{

      var fields_offset_ = repl.currentEnv.classes.get(classname);
      var fields_type = repl.currentTypeEnv.classes.get(classname)[0];
      var mem = new Uint32Array(memory.buffer);
      var display:Array<string> = [];
      // A[1][0] refers to the offset value of field A, sorted by the offset value to ensure the iteration has a consistent order. 
      var fields_offset = Array.from(fields_offset_.entries());
      fields_offset.sort((a,b) =>{
        return a[1][0] - b[1][0];
      });
      // the reason why pointer beacuse mem is u32 array(4 byte addressing) and the pointer value returned by the run method is in raw address(byte adress)
      // surprisingly(since there is also i64 in wasm), the offset stored int the currentenv is in 4 byte addressing.
      const space = " ";
      if(met_object.has(pointer)){
        display.push(`${space.repeat(level)}displayed ${met_object.get(pointer)}:${classname} object at addr ${pointer}: ...`);
        return display;
      }
      display.push(
      `${space.repeat(level)}${object_number}:${classname} object at addr ${pointer}: {`);
      met_object.set(pointer,object_number)
      fields_offset.forEach(thisfield =>{
        var thisfield_type = fields_type.get(thisfield[0]);
        if ( thisfield_type.tag ==="class"){
          if(mem[pointer/4 + thisfield[1][0]] === 0){
            display.push(`${space.repeat(level+2)}${thisfield[0]} : none `);
          }else{
            display.push(`${space.repeat(level+2)}${thisfield[0]}:{`)
            display.push(...console_log_class(repl,mem[pointer/4 + thisfield[1][0]],thisfield_type.name,level +5,met_object,object_number+1));
            display.push(`${space.repeat(level+2)}}`)
          }
        }else{
          display.push(`${space.repeat(level+2)}${thisfield[0]} : ${stringify(thisfield_type,mem[pointer/4 + thisfield[1][0]])} `);
        }
      }
      )
      display.push(
      `${space.repeat(level+1)}}`);
      return display;
    }
    var importObject = {
      imports: {
        assert_not_none: (arg: any) => assert_not_none(arg),
        print_num: (arg: number) => print(NUM, arg),
        print_bool: (arg: number) => print(BOOL, arg),
        print_none: (arg: number) => print(NONE, arg),
        abs: Math.abs,
        min: Math.min,
        max: Math.max,
        pow: Math.pow
      },
      libmemory: memoryModule.instance.exports,
      memory_values: memory,
      js: {memory: memory}
    };
    var repl = new BasicREPL(importObject);

    function renderResult(result : Value) : void {
      if(result === undefined) { console.log("skip"); return; }
      if (result.tag === "none") return;
      const elt = document.createElement("pre");
      document.getElementById("output").appendChild(elt);
      switch (result.tag) {
        case "num":
          elt.innerText = String(result.value);
          break;
        case "bool":
          elt.innerHTML = (result.value) ? "True" : "False";
          break;
        case "object":
          // elt.innerHTML = `${result.name} object at ${result.address}`
          elt.innerHTML = console_log_class(repl,result.address,result.name,0,new Map(), 1).join("\n");
          break
        default: throw new Error(`Could not render value: ${result}`);
      }
    }

    function renderError(result : any) : void {
      const elt = document.createElement("pre");
      document.getElementById("output").appendChild(elt);
      elt.setAttribute("style", "color: red");
      elt.innerText = String(result);
    }

    function setupRepl() {
      document.getElementById("output").innerHTML = "";
      const replCodeElement = document.getElementById("next-code") as HTMLTextAreaElement;
      replCodeElement.addEventListener("keypress", (e) => {

        if(e.shiftKey && e.key === "Enter") {
        } else if (e.key === "Enter") {
          e.preventDefault();
          const output = document.createElement("div");
          const prompt = document.createElement("span");
          prompt.innerText = "»";
          output.appendChild(prompt);
          const elt = document.createElement("textarea");
          // elt.type = "text";
          elt.disabled = true;
          elt.className = "repl-code";
          output.appendChild(elt);
          document.getElementById("output").appendChild(output);
          const source = replCodeElement.value;
          elt.value = source;
          replCodeElement.value = "";
          repl.run(source).then((r) => { renderResult(r); 
            printMem();
            console.log ("run finished") })
              .catch((e) => { renderError(e); console.log("run failed", e) });;
        }
      });
    }

    function resetRepl() {
      document.getElementById("output").innerHTML = "";
    }
    function printMem(){
      var mem = new Uint32Array(memory.buffer);
      for (let i = 0; i < 25; i++) {
        console.log (mem[i]);
      }
      // mem.forEach((x) => console.log(x));
    }

    function setupCodeExample() {
      const sel = document.querySelector("#exampleSelect") as HTMLSelectElement;
      sel.addEventListener("change", (e) => {
        const code = get_code_example(sel.value);
        if (code !== "") {
          const usercode = document.getElementById("user-code") as HTMLTextAreaElement;
          usercode.value = code;
        }
      })
    }
    document.getElementById("clear").addEventListener("click", function(e){
      //repl code disapper (on the right side)
      resetRepl()

      //reset environment
      repl = new BasicREPL(importObject)

      //clear editor code

      // var element = document.querySelector(".CodeMirror") as any
      // var editor = element.CodeMirror
      // editor.setValue("")
      // editor.clearHistory()
      var source = document.getElementById("user-code") as HTMLTextAreaElement
      source.value = ""

    })

    document.getElementById("load").addEventListener("change", function(e){
      resetRepl()

      repl = new BasicREPL(importObject)

      var input: any = e.target
      var reader = new FileReader()
      var codeNode = document.getElementById("user-code") as HTMLTextAreaElement
      codeNode.value = ""
      

      reader.onload =  function(){
        
        if (codeNode.value != ""){
          codeNode.value = ""
          codeNode.value = reader.result as string
        } else {
          codeNode.value = reader.result as string
        }

      }
      reader.readAsText(input.files[0])
      
    })
    // window.onload = function(e: Event){
    //   var f = document.getElementById("load")
    //   var reader = new FileReader();
    //   var readerContent
    //   f.onchange = function(){
    //     readerContent = reader.result
    //   }
    //   var contentToLoad = readerContent as string

    //   var codeNode= document.getElementById("user-code") as HTMLTextAreaElement
    //   codeNode.value = contentToLoad
    // }

    document.getElementById("save").addEventListener("click", function(e){
      var FileSaver = require("file-saver");
      var title = prompt("please input file name: ", "untitled")
      if (title != null){
        var codeNode= document.getElementById("user-code") as HTMLTextAreaElement
        var code = codeNode.value
        var blob = new Blob([code], { type: "text/plain;charset=utf-8" });
        FileSaver.saveAs(blob, title)
      }
    })


    document.getElementById("run").addEventListener("click", function(e) {
      repl = new BasicREPL(importObject);
      const source = document.getElementById("user-code") as HTMLTextAreaElement;
      resetRepl();
      repl.run(source.value).then((r) => { renderResult(r); console.log ("run finished") })
          .catch((e) => { renderError(e); console.log("run failed", e) });;
    });
    setupRepl();
    setupCodeExample();
  });
}

webStart();
