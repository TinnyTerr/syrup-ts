module Main (main) where

import GHC.Wasm.Prim
import Language.Syrup.Opt (defaultOptions, parseOptions)
import Language.Syrup.Run (syrup)

-- args: newline separated CLI flags (as for the syrup executable)
foreign export javascript "syrup" jsSyrup :: JSString -> JSString -> JSString

jsSyrup :: JSString -> JSString -> JSString
jsSyrup args src = toJSString $ case parseOptions defaultOptions (lines (fromJSString args)) of
  Left e -> "Error: " ++ e
  Right opts -> syrup opts (fromJSString src)

main :: IO ()
main = pure ()
