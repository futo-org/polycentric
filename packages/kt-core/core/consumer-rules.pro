# JNA + uniffi-generated bindings rely on reflection over native mappings.
-keep class com.sun.jna.** { *; }
-keep class org.futo.polycentric.ffi.** { *; }
-dontwarn java.awt.*
