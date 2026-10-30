import {test} from "node:test";
test("acceptance intentional failure; never merge",()=>{throw new Error("gate negative fixture")});
