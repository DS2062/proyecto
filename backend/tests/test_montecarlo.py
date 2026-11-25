import math
import tempfile
import unittest
from pathlib import Path

from app import create_app
from montecarlo import normalizar_entrada, simular_montecarlo
from queueing import ErrorValidacion


def configuracion_poisson(**cambios):
    datos = {
        "distribucion": "poisson",
        "num_variables": 3,
        "num_observaciones": 1000,
        "modo_parametro": "global",
        "parametro_global": 4,
        "confianza": 0.95,
        "semilla": 123,
    }
    datos.update(cambios)
    return datos


def configuracion_exponencial(**cambios):
    datos = {
        "distribucion": "exponencial",
        "num_variables": 2,
        "num_observaciones": 1000,
        "modo_parametro": "global",
        "parametro_global": 2.5,
        "tipo_parametro_global": "media",
        "confianza": 0.95,
        "semilla": 321,
    }
    datos.update(cambios)
    return datos


class MotorMontecarloTests(unittest.TestCase):
    def test_poisson_reproducible_con_misma_semilla(self):
        primero = simular_montecarlo(configuracion_poisson())
        segundo = simular_montecarlo(configuracion_poisson())
        self.assertEqual(primero["datos"]["filas"], segundo["datos"]["filas"])
        self.assertEqual(
            primero["variables"][0]["media_simulada"],
            segundo["variables"][0]["media_simulada"],
        )
        self.assertEqual(primero["configuracion"]["semilla"], 123)

        tercero = simular_montecarlo(configuracion_poisson(semilla=124))
        self.assertNotEqual(
            primero["datos"]["filas"], tercero["datos"]["filas"]
        )

    def test_poisson_estadisticas_cercanas_a_la_teoria(self):
        resultado = simular_montecarlo(
            configuracion_poisson(num_variables=1, num_observaciones=5000, semilla=2024)
        )
        variable = resultado["variables"][0]
        self.assertEqual(variable["media_teorica"], 4.0)
        self.assertEqual(variable["desviacion_teorica"], 2.0)
        self.assertLess(abs(variable["media_simulada"] - 4.0), 0.2)
        self.assertLess(abs(variable["desviacion_simulada"] - 2.0), 0.25)
        self.assertAlmostEqual(
            variable["error_tipico"],
            variable["desviacion_simulada"] / math.sqrt(5000),
            places=9,
        )
        self.assertLessEqual(variable["ic_inferior"], variable["media_simulada"])
        self.assertGreaterEqual(variable["ic_superior"], variable["media_simulada"])
        self.assertGreaterEqual(variable["minimo"], 0)
        self.assertTrue(math.isfinite(variable["maximo"]))
        self.assertEqual(variable["n"], 5000)

    def test_poisson_tabla_transformada(self):
        resultado = simular_montecarlo(
            configuracion_poisson(num_variables=1, num_observaciones=1000, semilla=55)
        )
        tabla = resultado["variables"][0]["tabla"]
        self.assertGreater(len(tabla), 5)
        self.assertEqual(tabla[0]["k"], 0)
        self.assertTrue(tabla[0]["intervalo"].startswith("[0.000000,"))
        self.assertEqual(sum(fila["frecuencia"] for fila in tabla), 1000)
        anterior = 0.0
        for fila in tabla:
            self.assertGreaterEqual(fila["p"], 0)
            self.assertGreaterEqual(fila["acumulada"], anterior)
            self.assertLessEqual(fila["acumulada"], 1.0)
            anterior = fila["acumulada"]
        self.assertAlmostEqual(tabla[-1]["acumulada"], 1.0, places=9)

    def test_exponencial_media_y_tasa_equivalentes(self):
        por_media = simular_montecarlo(
            configuracion_exponencial(
                num_variables=1, num_observaciones=5000, semilla=77
            )
        )
        variable = por_media["variables"][0]
        self.assertAlmostEqual(variable["media"], 2.5, places=9)
        self.assertAlmostEqual(variable["tasa"], 0.4, places=9)
        self.assertLess(abs(variable["media_simulada"] - 2.5), 0.25)
        self.assertLess(abs(variable["desviacion_simulada"] - 2.5), 0.3)
        self.assertGreater(variable["minimo"], 0)
        self.assertTrue(math.isfinite(variable["maximo"]))

        por_tasa = simular_montecarlo(
            configuracion_exponencial(
                num_variables=1,
                num_observaciones=5000,
                semilla=77,
                parametro_global=0.4,
                tipo_parametro_global="tasa",
            )
        )
        variable_tasa = por_tasa["variables"][0]
        self.assertAlmostEqual(variable_tasa["media"], 2.5, places=9)
        self.assertAlmostEqual(variable_tasa["tasa"], 0.4, places=9)
        self.assertLess(abs(variable_tasa["media_simulada"] - 2.5), 0.25)

    def test_exponencial_histograma(self):
        resultado = simular_montecarlo(
            configuracion_exponencial(num_variables=1, num_observaciones=2000)
        )
        tabla = resultado["variables"][0]["tabla"]
        self.assertGreaterEqual(len(tabla), 12)
        self.assertLessEqual(len(tabla), 30)
        self.assertEqual(sum(fila["frecuencia"] for fila in tabla), 2000)
        self.assertAlmostEqual(tabla[-1]["frecuencia_acumulada"], 1.0, places=6)
        self.assertGreaterEqual(tabla[0]["limite_inferior"], 0)
        self.assertGreater(tabla[-1]["limite_superior"], 0)
        for fila in tabla:
            self.assertTrue(math.isfinite(fila["densidad"]))
            self.assertGreaterEqual(fila["densidad_teorica"], 0)
            self.assertGreaterEqual(fila["acumulada"], fila["frecuencia_acumulada"] - 0.2)

    def test_poisson_lambda_alto_sin_desbordamiento(self):
        resultado = simular_montecarlo(
            configuracion_poisson(
                num_variables=1,
                num_observaciones=2000,
                parametro_global=10000,
                semilla=9,
            )
        )
        variable = resultado["variables"][0]
        self.assertTrue(math.isfinite(variable["media_simulada"]))
        self.assertTrue(math.isfinite(variable["desviacion_simulada"]))
        self.assertLess(abs(variable["media_simulada"] - 10000), 30)
        for valor in resultado["datos"]["filas"]:
            self.assertTrue(all(isinstance(x, int) and x >= 0 for x in valor))
        tabla = variable["tabla"]
        self.assertEqual(variable["tabla_info"]["tipo"], "intervalos")
        self.assertEqual(sum(fila["frecuencia"] for fila in tabla), 2000)
        self.assertGreater(len(tabla), 10)

    def test_variables_personalizadas_y_nombres(self):
        resultado = simular_montecarlo(
            {
                "distribucion": "exponencial",
                "num_variables": 2,
                "num_observaciones": 100,
                "modo_parametro": "personalizado",
                "confianza": 0.99,
                "semilla": 5,
                "variables": [
                    {"nombre": "Llegadas", "parametro": 1.5, "tipo_parametro": "media"},
                    {"nombre": "Servicio", "parametro": 0.5, "tipo_parametro": "tasa"},
                ],
            }
        )
        self.assertEqual(resultado["variables"][0]["nombre"], "Llegadas")
        self.assertEqual(resultado["variables"][1]["nombre"], "Servicio")
        self.assertAlmostEqual(resultado["variables"][1]["media"], 2.0, places=9)
        self.assertAlmostEqual(resultado["configuracion"]["z"], 2.5758293035, places=9)
        self.assertEqual(len(resultado["vista_previa"]["filas"]), 50)
        self.assertEqual(resultado["vista_previa"]["filas"][0]["observacion"], 1)

    def test_convergencia_incluye_puntos_y_media_teorica(self):
        resultado = simular_montecarlo(
            configuracion_poisson(num_variables=1, num_observaciones=1000)
        )
        puntos = resultado["variables"][0]["convergencia"]
        self.assertGreaterEqual(len(puntos), 50)
        self.assertEqual(puntos[0]["n"], 1)
        self.assertEqual(puntos[-1]["n"], 1000)
        self.assertEqual(puntos[-1]["media_teorica"], 4.0)

    def test_validaciones_montecarlo(self):
        casos = [
            configuracion_poisson(distribucion="normal"),
            configuracion_poisson(num_variables=0),
            configuracion_poisson(num_variables=21),
            configuracion_poisson(num_observaciones=9),
            configuracion_poisson(num_observaciones=50001),
            configuracion_poisson(parametro_global=0),
            configuracion_poisson(parametro_global=-1),
            configuracion_poisson(parametro_global=10001),
            configuracion_poisson(confianza=0.80),
            configuracion_poisson(semilla=1.5),
            configuracion_poisson(modo_parametro="otro"),
        ]
        for datos in casos:
            with self.subTest(datos=datos):
                with self.assertRaises(ErrorValidacion):
                    simular_montecarlo(datos)

        with self.assertRaises(ErrorValidacion):
            simular_montecarlo(
                {
                    "distribucion": "exponencial",
                    "num_variables": 2,
                    "num_observaciones": 100,
                    "modo_parametro": "personalizado",
                    "variables": [
                        {"parametro": 1, "tipo_parametro": "media"},
                    ],
                }
            )

        with self.assertRaises(ErrorValidacion):
            normalizar_entrada(
                {
                    "distribucion": "poisson",
                    "num_variables": 1,
                    "num_observaciones": 100,
                    "modo_parametro": "global",
                    "parametro_global": float("nan"),
                }
            )

    def test_semilla_automatica_se_guarda(self):
        datos = configuracion_poisson(num_variables=1, num_observaciones=10)
        datos.pop("semilla")
        resultado = simular_montecarlo(datos)
        self.assertIsInstance(resultado["configuracion"]["semilla"], int)
        self.assertIsNone(resultado["configuracion"]["semilla_solicitada"])

    def test_resumen_global(self):
        resultado = simular_montecarlo(
            configuracion_poisson(num_variables=3, num_observaciones=1000)
        )
        global_resumen = resultado["resumen_global"]
        self.assertGreaterEqual(global_resumen["cobertura_ic_pct"], 0)
        self.assertLessEqual(global_resumen["cobertura_ic_pct"], 100)
        self.assertEqual(global_resumen["variables_en_intervalo"], 3)
        self.assertAlmostEqual(global_resumen["media_teorica_promedio"], 4.0)


class ApiMontecarloTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "test_montecarlo.db"
        self.app = create_app({"TESTING": True, "DATABASE": str(self.db_path)})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def _simular(self, **cambios):
        datos = configuracion_poisson(**cambios)
        return self.client.post("/api/montecarlo/simular", json=datos)

    def test_flujo_completo_montecarlo(self):
        respuesta = self._simular()
        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.get_json()
        self.assertTrue(cuerpo["ok"])
        simulacion = cuerpo["simulacion"]
        self.assertEqual(simulacion["distribucion"], "poisson")
        self.assertEqual(simulacion["num_variables"], 3)
        self.assertEqual(simulacion["num_observaciones"], 1000)
        self.assertEqual(simulacion["semilla"], 123)
        self.assertEqual(len(simulacion["variables"]), 3)
        self.assertNotIn("tabla", simulacion["variables"][0])
        self.assertEqual(len(simulacion["vista_previa"]["filas"]), 50)
        simulacion_id = simulacion["id"]

        historial = self.client.get("/api/montecarlo/historial")
        self.assertEqual(historial.status_code, 200)
        datos_historial = historial.get_json()
        self.assertEqual(datos_historial["total"], 1)
        self.assertEqual(datos_historial["simulaciones"][0]["id"], simulacion_id)
        self.assertNotIn(
            "convergencia", datos_historial["simulaciones"][0]["variables"][0]
        )

        detalle = self.client.get(
            f"/api/montecarlo/historial/{simulacion_id}"
        )
        self.assertEqual(detalle.status_code, 200)
        self.assertEqual(
            detalle.get_json()["simulacion"]["vista_previa"]["total"], 1000
        )

        variable = self.client.get(
            f"/api/montecarlo/simulacion/{simulacion_id}/variable/0"
        )
        self.assertEqual(variable.status_code, 200)
        variable_json = variable.get_json()["variable"]
        self.assertGreater(len(variable_json["tabla"]), 5)
        self.assertIn("tabla_info", variable_json)
        self.assertEqual(len(variable_json["convergencia"]), 80)

        pagina = self.client.get(
            f"/api/montecarlo/simulacion/{simulacion_id}/datos"
            "?offset=0&limit=50&incluir_u=1&variable_u=0"
        )
        self.assertEqual(pagina.status_code, 200)
        pagina_json = pagina.get_json()
        self.assertEqual(len(pagina_json["filas"]), 50)
        self.assertTrue(pagina_json["incluir_u"])
        self.assertEqual(pagina_json["filas"][0]["observacion"], 1)
        self.assertIn("u", pagina_json["filas"][0])

        ultima = self.client.get(
            f"/api/montecarlo/simulacion/{simulacion_id}/datos?offset=990&limit=50"
        )
        self.assertEqual(ultima.status_code, 200)
        self.assertEqual(len(ultima.get_json()["filas"]), 10)

        eliminado = self.client.delete(
            f"/api/montecarlo/historial/{simulacion_id}"
        )
        self.assertEqual(eliminado.status_code, 200)
        self.assertEqual(
            self.client.get(
                f"/api/montecarlo/historial/{simulacion_id}"
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/api/montecarlo/historial").get_json()["total"], 0
        )

    def test_pagina_montecarlo(self):
        pagina = self.client.get("/simulacion-montecarlo")
        self.assertEqual(pagina.status_code, 200)
        html = pagina.get_data(as_text=True)
        self.assertIn("Configura la simulación", html)
        self.assertIn("Monte Carlo", html)
        self.assertIn('data-bs-target="#guiaMC"', html)
        self.assertIn("graficaDistribucion", html)

    def test_errores_de_validacion_api(self):
        respuesta = self.client.post(
            "/api/montecarlo/simular",
            json=configuracion_poisson(parametro_global=0),
        )
        self.assertEqual(respuesta.status_code, 400)
        self.assertFalse(respuesta.get_json()["ok"])
        self.assertEqual(respuesta.get_json()["campo"], "parametro_global")

        respuesta = self.client.post(
            "/api/montecarlo/simular",
            json=configuracion_poisson(num_variables=21),
        )
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(respuesta.get_json()["campo"], "num_variables")

        simulacion = self._simular(num_variables=1).get_json()["simulacion"]
        respuesta = self.client.get(
            f"/api/montecarlo/simulacion/{simulacion['id']}/variable/4"
        )
        self.assertEqual(respuesta.status_code, 400)

    def test_detalle_inexistente(self):
        self.assertEqual(
            self.client.get("/api/montecarlo/historial/999").status_code, 404
        )
        self.assertEqual(
            self.client.delete("/api/montecarlo/historial/999").status_code, 404
        )
        self.assertEqual(
            self.client.get(
                "/api/montecarlo/simulacion/999/datos"
            ).status_code,
            404,
        )

    def test_datos_sin_u(self):
        simulacion = self._simular(num_variables=1).get_json()["simulacion"]
        respuesta = self.client.get(
            f"/api/montecarlo/simulacion/{simulacion['id']}/datos"
        )
        self.assertEqual(respuesta.status_code, 200)
        pagina = respuesta.get_json()
        self.assertFalse(pagina["incluir_u"])
        self.assertNotIn("u", pagina["filas"][0])


if __name__ == "__main__":
    unittest.main()
