// ESLint con UN objetivo concreto: que no se vuelva a desplegar una pantalla
// en blanco por una variable que no existe.
//
// Ha pasado DOS veces en producción y las dos `vite build` compiló sin decir
// nada, porque esbuild transpila pero no resuelve identificadores:
//
//   - 28-ago-2026: pantalla en blanco que le pegó a TODOS los perfiles.
//   - 01-sep-2026: `otDelBultoDeSalida is not defined` en recepcionPT.js. La
//     función se borró en un commit y sus TRES llamadas quedaron en pie.
//     Valeria veía su pestaña "Recibir" un segundo y luego en blanco.
//
// Por eso la configuración es deliberadamente MÍNIMA: `no-undef` y poco más.
// No es un linter de estilo — nadie va a arreglar 400 avisos de formato, y un
// linter que grita por todo se acaba ignorando, que es como se cuela el
// siguiente `is not defined`. Si algún día se quiere estilo, que sea otra
// pasada y otra discusión.
//
//   npm run lint     (desde web/)
//
// Corre sobre `src/` y `scripts/`.
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/**/*.{js,jsx}', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // Los inyecta vite.config.js en cada build (ver Novedades.jsx).
        __VERSION_FECHA__: 'readonly',
        __VERSION_COMMIT__: 'readonly'
      },
      parserOptions: {
        // JSX sin necesitar el plugin de React: alcanza para que `no-undef`
        // vea los componentes usados en el marcado.
        ecmaFeatures: { jsx: true }
      }
    },
    // `react` solo por la regla jsx-uses-vars: sin ella, cada componente usado
    // en el marcado se reporta como "importado y no usado" y el reporte se
    // llena de mentiras. `react-hooks` porque el codigo YA tiene comentarios
    // `eslint-disable-next-line react-hooks/exhaustive-deps`: sin el plugin,
    // esos comentarios apuntan a una regla que no existe y ESLint lo marca
    // como error — 20 errores falsos que tapan a los de verdad.
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    linterOptions: {
      reportUnusedDisableDirectives: true
    },
    rules: {
      // LA REGLA. Todo lo demás es acompañamiento.
      'no-undef': 'error',
      // Marca como usados los componentes que solo aparecen en el JSX.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Las dependencias de los hooks: aviso, no error. Vale la pena verlas,
      // pero el código ya trae disables deliberados y no debe frenar nada.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
      // Un `case` que se cuela al siguiente casi siempre es un olvido.
      'no-fallthrough': 'error',
      // `if (x = 1)` en vez de `==`.
      'no-cond-assign': 'error',
      // Declarar dos veces lo mismo: una de las dos sobra y suele ser un merge.
      'no-redeclare': 'error',
      // Llamar a algo antes de definirlo revienta igual que no definirlo.
      // `variables: false` a propósito: en un componente es normal definir un
      // manejador más abajo del JSX que lo menciona, y eso NO truena porque el
      // JSX se evalúa al renderizar. Marcarlo daría 6 errores falsos.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
      // Un import que ya no se usa suele ser el rastro de un borrado a medias
      // — que es exactamente cómo empezó el bug del 01-sep. Aviso, no error:
      // no debe frenar un despliegue urgente.
      'no-unused-vars': [
        'warn',
        { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }
      ]
    }
  }
]
