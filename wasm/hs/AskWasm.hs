module Main (main) where

import GHC.Wasm.Prim
import Language.Ask.ChkRaw (filth)

foreign export javascript "filth" jsFilth :: JSString -> JSString

jsFilth :: JSString -> JSString
jsFilth = toJSString . filth . fromJSString

main :: IO ()
main = pure ()
